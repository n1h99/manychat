import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  evaluateCondition,
  scenarioGraphSchema,
  type ConditionOperator,
  type ScenarioGraph,
  type ScenarioGraphEdge,
  type ScenarioGraphNode,
} from '@omnicus/automation-core';
import type { Prisma } from '@omnicus/database';

import { DatabaseService } from '../database/database.service';

export interface AutomationTriggerInput {
  contactId: string;
  connectionId: string;
  conversationId: string;
  normalizedEventId: string;
  projectId: string;
}

type RuntimeTransaction = Prisma.TransactionClient;

@Injectable()
export class AutomationRuntimeService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async trigger(input: AutomationTriggerInput): Promise<void> {
    await this.database.client.$transaction((transaction) =>
      this.triggerInTransaction(transaction, input),
    );
  }

  async triggerInTransaction(
    transaction: RuntimeTransaction,
    input: AutomationTriggerInput,
  ): Promise<void> {
    const [contact, conversation, event, scenarios] = await Promise.all([
      transaction.contact.findUnique({
        select: { automationMode: true, customFields: true },
        where: { projectId_id: { id: input.contactId, projectId: input.projectId } },
      }),
      transaction.conversation.findUnique({
        select: { automationModeOverride: true },
        where: { projectId_id: { id: input.conversationId, projectId: input.projectId } },
      }),
      transaction.normalizedEvent.findUnique({
        select: { payload: true, type: true },
        where: { projectId_id: { id: input.normalizedEventId, projectId: input.projectId } },
      }),
      transaction.scenario.findMany({
        include: { activeVersion: { select: { compiledDefinition: true, id: true } } },
        where: { projectId: input.projectId, status: 'PUBLISHED' },
      }),
    ]);
    if (!contact || !conversation || !event) return;
    const mode = conversation.automationModeOverride ?? contact.automationMode ?? 'ENABLED';
    if (mode !== 'ENABLED') return;

    const eligible = scenarios.filter((scenario) => scenario.activeVersion?.compiledDefinition);
    if (!eligible.length) return;
    const advanced = await transaction.conversation.update({
      data: { nextAutomationSequence: { increment: 1 } },
      select: { nextAutomationSequence: true },
      where: { projectId_id: { id: input.conversationId, projectId: input.projectId } },
    });
    const sequence = advanced.nextAutomationSequence - BigInt(1);
    for (const scenario of eligible) {
      const version = scenario.activeVersion!;
      const parsed = scenarioGraphSchema.safeParse(version.compiledDefinition);
      if (!parsed.success) continue;
      const execution = await transaction.scenarioExecution.upsert({
        create: {
          contactId: input.contactId,
          conversationId: input.conversationId,
          conversationSequence: sequence,
          correlationId: `normalized-event:${input.normalizedEventId}`,
          projectId: input.projectId,
          scenarioId: scenario.id,
          scenarioVersionId: version.id,
          startedAt: new Date(),
          status: 'RUNNING',
          triggerEventId: input.normalizedEventId,
          triggerKey: input.normalizedEventId,
        },
        update: {},
        where: {
          projectId_scenarioId_triggerKey: {
            projectId: input.projectId,
            scenarioId: scenario.id,
            triggerKey: input.normalizedEventId,
          },
        },
      });
      if (execution.status === 'COMPLETED') continue;
      await this.executeGraph(
        transaction,
        parsed.data,
        execution.id,
        input,
        event.payload,
        contact.customFields,
      );
    }
  }

  private async executeGraph(
    transaction: RuntimeTransaction,
    graph: ScenarioGraph,
    executionId: string,
    input: AutomationTriggerInput,
    eventPayload: Prisma.JsonValue,
    customFields: Prisma.JsonValue,
  ): Promise<void> {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const outgoing = new Map<string, ScenarioGraphEdge[]>();
    for (const edge of graph.edges)
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    let node = graph.nodes.find((candidate) => candidate.type === 'INCOMING_MESSAGE');
    let steps = 0;
    while (node && steps++ <= graph.nodes.length) {
      await this.nodeExecution(transaction, executionId, input.projectId, node, 'PROCESSING');
      const next = await this.applyNode(
        transaction,
        node,
        outgoing.get(node.id) ?? [],
        input,
        eventPayload,
        customFields,
        executionId,
      );
      await this.nodeExecution(transaction, executionId, input.projectId, node, 'SUCCEEDED');
      node = next ? nodes.get(next.to) : undefined;
    }
    await transaction.scenarioExecution.update({
      data: { completedAt: new Date(), currentNodeId: null, status: 'COMPLETED' },
      where: { projectId_id: { id: executionId, projectId: input.projectId } },
    });
  }

  private async applyNode(
    transaction: RuntimeTransaction,
    node: ScenarioGraphNode,
    edges: ScenarioGraphEdge[],
    input: AutomationTriggerInput,
    eventPayload: Prisma.JsonValue,
    customFields: Prisma.JsonValue,
    executionId: string,
  ): Promise<ScenarioGraphEdge | undefined> {
    if (node.type === 'STOP') return undefined;
    if (node.type === 'CONDITION') {
      const config = node.config as {
        field?: string;
        operator?: ConditionOperator;
        value?: unknown;
      };
      const actual = this.valueFor(config.field, eventPayload, customFields);
      const selected = edges
        .slice()
        .sort(
          (left, right) =>
            (left.priority ?? Number.MAX_SAFE_INTEGER) -
            (right.priority ?? Number.MAX_SAFE_INTEGER),
        )
        .find((_edge) => evaluateCondition(config.operator ?? 'exists', actual, config.value));
      return selected;
    }
    if (node.type === 'ADD_TAG' || node.type === 'REMOVE_TAG') {
      const tagId = typeof node.config.tagId === 'string' ? node.config.tagId : undefined;
      if (tagId) {
        if (node.type === 'ADD_TAG')
          await transaction.contactTag.createMany({
            data: [
              {
                contactId: input.contactId,
                projectId: input.projectId,
                source: 'automation',
                tagId,
              },
            ],
            skipDuplicates: true,
          });
        else
          await transaction.contactTag.deleteMany({
            where: { contactId: input.contactId, projectId: input.projectId, tagId },
          });
      }
    }
    if (node.type === 'SEND_MESSAGE')
      await this.queueMessage(transaction, node, input, executionId);
    if (node.type === 'CREATE_OR_UPDATE_LEAD' || node.type === 'FORWARD_TO_CRM')
      await this.queueCrmOperation(transaction, node, input, executionId);
    return edges.find((edge) => edge.output === 'default') ?? edges[0];
  }

  private async queueCrmOperation(
    transaction: RuntimeTransaction,
    node: ScenarioGraphNode,
    input: AutomationTriggerInput,
    executionId: string,
  ): Promise<void> {
    const idempotencyKey = `crm-${executionId}-${node.id}`;
    const existing = await transaction.outboxRecord.findUnique({
      where: { projectId_idempotencyKey: { idempotencyKey, projectId: input.projectId } },
    });
    if (existing) return;
    const outbox = await transaction.outboxRecord.create({
      data: { idempotencyKey, kind: 'CRM', payload: {}, projectId: input.projectId },
    });
    const operation = await transaction.crmOperation.create({
      data: {
        contactId: input.contactId,
        inputSafe: { nodeId: node.id, scenarioExecutionId: executionId },
        normalizedEventId: input.normalizedEventId,
        outboxRecordId: outbox.id,
        projectId: input.projectId,
        type:
          node.type === 'CREATE_OR_UPDATE_LEAD'
            ? 'CREATE_OR_UPDATE_LEAD'
            : 'FORWARD_INBOUND_MESSAGE',
      },
    });
    await transaction.outboxRecord.update({
      data: { payload: { crmOperationId: operation.id } },
      where: { projectId_id: { id: outbox.id, projectId: input.projectId } },
    });
  }

  private async queueMessage(
    transaction: RuntimeTransaction,
    node: ScenarioGraphNode,
    input: AutomationTriggerInput,
    executionId: string,
  ): Promise<void> {
    const text = typeof node.config.text === 'string' ? node.config.text : undefined;
    if (!text) return;
    const identity = await transaction.channelIdentity.findFirst({
      where: {
        connectionId: input.connectionId,
        contactId: input.contactId,
        projectId: input.projectId,
        status: 'ACTIVE',
      },
    });
    if (!identity) return;
    const idempotencyKey = `automation-${executionId}-${node.id}`;
    const existing = await transaction.outboxRecord.findUnique({
      where: { projectId_idempotencyKey: { idempotencyKey, projectId: input.projectId } },
    });
    if (existing) return;
    const message = await transaction.message.create({
      data: {
        connectionId: input.connectionId,
        contactId: input.contactId,
        content: { text },
        conversationId: input.conversationId,
        direction: 'OUTBOUND',
        metadata: { source: 'automation' },
        projectId: input.projectId,
        status: 'QUEUED',
        type: 'TEXT',
      },
    });
    await transaction.outboxRecord.create({
      data: {
        connectionId: input.connectionId,
        idempotencyKey,
        payload: { channelIdentityId: identity.id, messageId: message.id },
        projectId: input.projectId,
      },
    });
  }

  private async nodeExecution(
    transaction: RuntimeTransaction,
    executionId: string,
    projectId: string,
    node: ScenarioGraphNode,
    status: 'PROCESSING' | 'SUCCEEDED',
  ): Promise<void> {
    const idempotencyKey = createHash('sha256').update(`${executionId}:${node.id}:1`).digest('hex');
    await transaction.nodeExecution.upsert({
      create: {
        attempt: 1,
        completedAt: status === 'SUCCEEDED' ? new Date() : null,
        idempotencyKey,
        inputSafe: {},
        nodeId: node.id,
        nodeType: node.type,
        projectId,
        scenarioExecutionId: executionId,
        startedAt: new Date(),
        status,
      },
      update: status === 'SUCCEEDED' ? { completedAt: new Date(), status } : {},
      where: { projectId_idempotencyKey: { idempotencyKey, projectId } },
    });
  }

  private valueFor(
    field: string | undefined,
    payload: Prisma.JsonValue,
    customFields: Prisma.JsonValue,
  ): unknown {
    const content = this.object(payload).content;
    if (field === 'message.text') return this.object(content ?? null).text ?? null;
    if (field?.startsWith('contact.customFields.'))
      return this.object(customFields)[field.slice(21)];
    return undefined;
  }

  private object(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }
}
