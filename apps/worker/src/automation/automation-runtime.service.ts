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
import { renderTemplate } from '@omnicus/media-core';

import { DatabaseService } from '../database/database.service';

export interface AutomationTriggerInput {
  contactId: string;
  connectionId: string;
  conversationId: string;
  normalizedEventId: string;
  projectId: string;
}

type RuntimeTransaction = Prisma.TransactionClient;

interface RuntimeContext extends AutomationTriggerInput {
  contactVariables: Record<string, Prisma.JsonValue>;
  customFields: Prisma.JsonValue;
  eventPayload: Prisma.JsonValue;
  subflowDepth: number;
}

interface NodeResult {
  next?: ScenarioGraphEdge | undefined;
  suspended?: boolean;
}

const stepBudget = 100;

@Injectable()
export class AutomationRuntimeService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async trigger(input: AutomationTriggerInput): Promise<void> {
    await this.database.client.$transaction((transaction) =>
      this.triggerInTransaction(transaction, input),
    );
  }

  /** Resolves durable waits before normal scenario triggering for the same inbound event. */
  async resolveWaitsInTransaction(
    transaction: RuntimeTransaction,
    input: AutomationTriggerInput,
  ): Promise<void> {
    const activeWaits = await transaction.waitState.findMany({
      select: { id: true, projectId: true, scenarioExecutionId: true, successNodeId: true },
      where: {
        conversationId: input.conversationId,
        projectId: input.projectId,
        status: 'ACTIVE',
      },
    });
    for (const wait of activeWaits) {
      const won = await transaction.waitState.updateMany({
        data: {
          resolvedAt: new Date(),
          resolvedByEventId: input.normalizedEventId,
          status: 'RESOLVED',
        },
        where: { id: wait.id, projectId: wait.projectId, status: 'ACTIVE' },
      });
      if (won.count === 1) {
        await this.resumeExecutionInTransaction(
          transaction,
          wait.scenarioExecutionId,
          input.projectId,
          wait.successNodeId,
          {
            ...input,
          },
        );
      }
    }
  }

  async triggerInTransaction(
    transaction: RuntimeTransaction,
    input: AutomationTriggerInput,
  ): Promise<void> {
    const [contact, conversation, event, scenarios] = await Promise.all([
      transaction.contact.findUnique({
        select: {
          automationMode: true,
          customFields: true,
          displayName: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          username: true,
        },
        where: { projectId_id: { id: input.contactId, projectId: input.projectId } },
      }),
      transaction.conversation.findUnique({
        select: { automationModeOverride: true },
        where: { projectId_id: { id: input.conversationId, projectId: input.projectId } },
      }),
      transaction.normalizedEvent.findUnique({
        select: { payload: true },
        where: { projectId_id: { id: input.normalizedEventId, projectId: input.projectId } },
      }),
      transaction.scenario.findMany({
        include: { activeVersion: { select: { compiledDefinition: true, id: true } } },
        where: { projectId: input.projectId, status: 'PUBLISHED' },
      }),
    ]);
    if (!contact || !conversation || !event) return;
    if ((conversation.automationModeOverride ?? contact.automationMode ?? 'ENABLED') !== 'ENABLED')
      return;

    const advanced = await transaction.conversation.update({
      data: { nextAutomationSequence: { increment: 1 } },
      select: { nextAutomationSequence: true },
      where: { projectId_id: { id: input.conversationId, projectId: input.projectId } },
    });
    const context: RuntimeContext = {
      ...input,
      contactVariables: this.contactVariables(contact),
      customFields: contact.customFields,
      eventPayload: event.payload,
      subflowDepth: 0,
    };
    for (const scenario of scenarios) {
      const version = scenario.activeVersion;
      if (!version?.compiledDefinition) continue;
      const graph = scenarioGraphSchema.safeParse(version.compiledDefinition);
      if (!graph.success) continue;
      const execution = await transaction.scenarioExecution.upsert({
        create: {
          contactId: input.contactId,
          conversationId: input.conversationId,
          conversationSequence: advanced.nextAutomationSequence - BigInt(1),
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
      if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(execution.status)) {
        await this.executeGraph(transaction, graph.data, execution.id, context);
      }
    }
  }

  async resumeDelayedAction(actionId: string): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const action = await transaction.delayedAction.findUnique({ where: { id: actionId } });
      if (!action || action.status !== 'PENDING') return;
      const claimed = await transaction.delayedAction.updateMany({
        data: {
          attempts: { increment: 1 },
          lockedAt: new Date(),
          lockedBy: `automation:${process.pid}`,
          status: 'PROCESSING',
        },
        where: { id: action.id, status: 'PENDING' },
      });
      if (claimed.count !== 1) return;
      try {
        await this.resumeExecutionInTransaction(
          transaction,
          action.scenarioExecutionId,
          action.projectId,
          action.resumeNodeId,
        );
        await transaction.delayedAction.updateMany({
          data: { completedAt: new Date(), lockedAt: null, lockedBy: null, status: 'COMPLETED' },
          where: { id: action.id, lockedBy: `automation:${process.pid}`, status: 'PROCESSING' },
        });
      } catch {
        await transaction.delayedAction.updateMany({
          data: { lockedAt: null, lockedBy: null, status: 'PENDING' },
          where: { id: action.id, lockedBy: `automation:${process.pid}`, status: 'PROCESSING' },
        });
        throw new Error('automation_delay_resume_failed');
      }
    });
  }

  async timeoutWait(waitId: string): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const wait = await transaction.waitState.findUnique({ where: { id: waitId } });
      if (!wait || wait.status !== 'ACTIVE' || wait.expiresAt > new Date()) return;
      const won = await transaction.waitState.updateMany({
        data: { resolvedAt: new Date(), status: 'TIMED_OUT' },
        where: { id: wait.id, status: 'ACTIVE' },
      });
      if (won.count === 1) {
        await this.resumeExecutionInTransaction(
          transaction,
          wait.scenarioExecutionId,
          wait.projectId,
          wait.timeoutNodeId,
        );
      }
    });
  }

  private async resumeExecutionInTransaction(
    transaction: RuntimeTransaction,
    executionId: string,
    projectId: string,
    startNodeId?: string | null,
    eventOverride?: AutomationTriggerInput,
  ): Promise<void> {
    const execution = await transaction.scenarioExecution.findUnique({
      include: { scenarioVersion: { select: { compiledDefinition: true } } },
      where: { projectId_id: { id: executionId, projectId } },
    });
    if (
      !execution ||
      !execution.scenarioVersion.compiledDefinition ||
      ['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status)
    )
      return;
    const graph = scenarioGraphSchema.safeParse(execution.scenarioVersion.compiledDefinition);
    if (!graph.success) throw new Error('automation_graph_invalid');
    const [contact, event] = await Promise.all([
      transaction.contact.findUnique({
        where: { projectId_id: { id: execution.contactId, projectId } },
      }),
      transaction.normalizedEvent.findUnique({
        where: {
          projectId_id: {
            id: eventOverride?.normalizedEventId ?? execution.triggerEventId,
            projectId,
          },
        },
      }),
    ]);
    if (!contact || !event) throw new Error('automation_execution_context_missing');
    await transaction.scenarioExecution.update({
      data: { currentNodeId: startNodeId ?? null, status: 'RUNNING' },
      where: { projectId_id: { id: executionId, projectId } },
    });
    await this.executeGraph(
      transaction,
      graph.data,
      executionId,
      {
        connectionId:
          eventOverride?.connectionId ??
          (
            await transaction.conversation.findUniqueOrThrow({
              where: { projectId_id: { id: execution.conversationId, projectId } },
            })
          ).connectionId,
        contactId: execution.contactId,
        contactVariables: this.contactVariables(contact),
        conversationId: execution.conversationId,
        customFields: contact.customFields,
        eventPayload: event.payload,
        normalizedEventId: eventOverride?.normalizedEventId ?? execution.triggerEventId,
        projectId,
        subflowDepth: 0,
      },
      startNodeId ?? undefined,
    );
  }

  private async executeGraph(
    transaction: RuntimeTransaction,
    graph: ScenarioGraph,
    executionId: string,
    context: RuntimeContext,
    startNodeId?: string,
  ): Promise<void> {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const outgoing = new Map<string, ScenarioGraphEdge[]>();
    for (const edge of graph.edges)
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    let node = startNodeId
      ? nodes.get(startNodeId)
      : graph.nodes.find((item) => item.type === 'INCOMING_MESSAGE');
    let steps = 0;
    while (node && steps++ < stepBudget) {
      await transaction.scenarioExecution.update({
        data: { currentNodeId: node.id, status: 'RUNNING' },
        where: { projectId_id: { id: executionId, projectId: context.projectId } },
      });
      await this.nodeExecution(transaction, executionId, context.projectId, node, 'PROCESSING');
      const result = await this.applyNode(
        transaction,
        node,
        outgoing.get(node.id) ?? [],
        context,
        executionId,
      );
      await this.nodeExecution(transaction, executionId, context.projectId, node, 'SUCCEEDED');
      if (result.suspended) return;
      node = result.next ? nodes.get(result.next.to) : undefined;
    }
    if (steps >= stepBudget) throw new Error('automation_step_budget_exhausted');
    await transaction.scenarioExecution.update({
      data: { completedAt: new Date(), currentNodeId: null, status: 'COMPLETED' },
      where: { projectId_id: { id: executionId, projectId: context.projectId } },
    });
    await this.resumeParentIfNeeded(transaction, executionId, context.projectId);
  }

  private async applyNode(
    transaction: RuntimeTransaction,
    node: ScenarioGraphNode,
    edges: ScenarioGraphEdge[],
    context: RuntimeContext,
    executionId: string,
  ): Promise<NodeResult> {
    const defaultEdge = edges.find((edge) => edge.output === 'default') ?? edges[0];
    if (node.type === 'STOP') return {};
    if (node.type === 'CONDITION') {
      const config = node.config as {
        field?: string;
        operator?: ConditionOperator;
        value?: unknown;
      };
      return {
        next: edges
          .slice()
          .sort(
            (a, b) =>
              (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER),
          )
          .find((edge) => {
            const rule = edge.condition ?? config;
            return evaluateCondition(
              rule.operator ?? 'exists',
              this.valueFor(rule.field, context.eventPayload, context.customFields),
              rule.value,
            );
          }),
      };
    }
    if (node.type === 'DELAY') {
      const seconds = node.config.delaySeconds;
      if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0)
        throw new Error('automation_delay_invalid');
      const execution = await transaction.scenarioExecution.findUniqueOrThrow({
        where: { projectId_id: { id: executionId, projectId: context.projectId } },
      });
      await transaction.delayedAction.upsert({
        create: {
          nextAttemptAt: new Date(Date.now() + seconds * 1_000),
          nodeId: node.id,
          projectId: context.projectId,
          resumeNodeId: defaultEdge?.to ?? null,
          scenarioExecutionId: executionId,
          scenarioId: execution.scenarioId,
          scenarioVersionId: execution.scenarioVersionId,
        },
        update: {},
        where: {
          projectId_scenarioExecutionId_nodeId: {
            nodeId: node.id,
            projectId: context.projectId,
            scenarioExecutionId: executionId,
          },
        },
      });
      await transaction.scenarioExecution.update({
        data: { currentNodeId: node.id, status: 'WAITING' },
        where: { projectId_id: { id: executionId, projectId: context.projectId } },
      });
      return { suspended: true };
    }
    if (node.type === 'WAIT_FOR_REPLY') {
      const seconds = node.config.timeoutSeconds;
      if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0)
        throw new Error('automation_wait_invalid');
      const execution = await transaction.scenarioExecution.findUniqueOrThrow({
        where: { projectId_id: { id: executionId, projectId: context.projectId } },
      });
      const replyEdge = edges.find((edge) => edge.output === 'reply') ?? defaultEdge;
      const timeoutEdge = edges.find((edge) => edge.output === 'timeout');
      await transaction.waitState.upsert({
        create: {
          conversationId: context.conversationId,
          criteria: {},
          expiresAt: new Date(Date.now() + seconds * 1_000),
          nodeId: node.id,
          projectId: context.projectId,
          scenarioExecutionId: executionId,
          scenarioId: execution.scenarioId,
          scenarioVersionId: execution.scenarioVersionId,
          successNodeId: replyEdge?.to ?? null,
          timeoutNodeId: timeoutEdge?.to ?? null,
        },
        update: {},
        where: {
          projectId_scenarioExecutionId_nodeId: {
            nodeId: node.id,
            projectId: context.projectId,
            scenarioExecutionId: executionId,
          },
        },
      });
      await transaction.scenarioExecution.update({
        data: { currentNodeId: node.id, status: 'WAITING' },
        where: { projectId_id: { id: executionId, projectId: context.projectId } },
      });
      return { suspended: true };
    }
    if (node.type === 'START_SUBFLOW') {
      const scenarioId =
        typeof node.config.scenarioId === 'string' ? node.config.scenarioId : undefined;
      const scenarioVersionId =
        typeof node.config.scenarioVersionId === 'string'
          ? node.config.scenarioVersionId
          : undefined;
      if (!scenarioId || !scenarioVersionId) throw new Error('automation_subflow_invalid');
      if (context.subflowDepth >= 10) throw new Error('automation_subflow_depth_exceeded');
      const target = await transaction.scenario.findUnique({
        where: { projectId_id: { id: scenarioId, projectId: context.projectId } },
      });
      const targetVersion = await transaction.scenarioVersion.findFirst({
        where: {
          id: scenarioVersionId,
          projectId: context.projectId,
          scenarioId,
          status: { in: ['PUBLISHED', 'SUPERSEDED'] },
        },
      });
      if (!target || !targetVersion?.compiledDefinition)
        throw new Error('automation_subflow_unpublished');
      const child = await transaction.scenarioExecution.upsert({
        create: {
          contactId: context.contactId,
          conversationId: context.conversationId,
          conversationSequence: BigInt(0),
          correlationId: `subflow:${executionId}:${node.id}`,
          parentExecutionId: executionId,
          projectId: context.projectId,
          resumeNodeId: defaultEdge?.to ?? null,
          scenarioId: target.id,
          scenarioVersionId: targetVersion.id,
          startedAt: new Date(),
          status: 'RUNNING',
          triggerEventId: context.normalizedEventId,
          triggerKey: `subflow:${executionId}:${node.id}`,
        },
        update: {},
        where: {
          projectId_scenarioId_triggerKey: {
            projectId: context.projectId,
            scenarioId: target.id,
            triggerKey: `subflow:${executionId}:${node.id}`,
          },
        },
      });
      const awaitChild = node.config.await !== false;
      if (awaitChild)
        await transaction.scenarioExecution.update({
          data: { currentNodeId: node.id, status: 'WAITING' },
          where: { projectId_id: { id: executionId, projectId: context.projectId } },
        });
      const graph = scenarioGraphSchema.safeParse(targetVersion.compiledDefinition);
      if (!graph.success) throw new Error('automation_subflow_graph_invalid');
      if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(child.status))
        await this.executeGraph(transaction, graph.data, child.id, {
          ...context,
          subflowDepth: context.subflowDepth + 1,
        });
      return awaitChild ? { suspended: true } : { next: defaultEdge };
    }
    if (node.type === 'SET_CUSTOM_FIELD') {
      const key = typeof node.config.key === 'string' ? node.config.key : undefined;
      if (!key) throw new Error('automation_custom_field_invalid');
      await transaction.contact.update({
        data: {
          customFields: {
            ...this.object(context.customFields),
            [key]: node.config.value as Prisma.JsonValue,
          },
        },
        where: { projectId_id: { id: context.contactId, projectId: context.projectId } },
      });
      context.customFields = {
        ...this.object(context.customFields),
        [key]: node.config.value as Prisma.JsonValue,
      };
    }
    if (node.type === 'PAUSE_AUTOMATION' || node.type === 'RESUME_AUTOMATION') {
      await transaction.contact.update({
        data: { automationMode: node.type === 'PAUSE_AUTOMATION' ? 'DISABLED' : 'ENABLED' },
        where: { projectId_id: { id: context.contactId, projectId: context.projectId } },
      });
    }
    if (node.type === 'ADD_TAG' || node.type === 'REMOVE_TAG')
      await this.applyTag(transaction, node, context);
    if (node.type === 'SEND_MESSAGE' || node.type === 'SEND_TEMPLATE')
      await this.queueMessage(transaction, node, context, executionId);
    if (node.type === 'CREATE_OR_UPDATE_LEAD' || node.type === 'FORWARD_TO_CRM')
      await this.queueCrmOperation(transaction, node, context, executionId);
    return { next: defaultEdge };
  }

  private async resumeParentIfNeeded(
    transaction: RuntimeTransaction,
    executionId: string,
    projectId: string,
  ): Promise<void> {
    const child = await transaction.scenarioExecution.findUnique({
      where: { projectId_id: { id: executionId, projectId } },
    });
    if (!child?.parentExecutionId) return;
    const parent = await transaction.scenarioExecution.findUnique({
      where: { projectId_id: { id: child.parentExecutionId, projectId } },
    });
    if (!parent || parent.status !== 'WAITING') return;
    await this.resumeExecutionInTransaction(transaction, parent.id, projectId, child.resumeNodeId);
  }

  private async applyTag(
    transaction: RuntimeTransaction,
    node: ScenarioGraphNode,
    context: RuntimeContext,
  ): Promise<void> {
    const tagId = typeof node.config.tagId === 'string' ? node.config.tagId : undefined;
    if (!tagId) return;
    if (node.type === 'ADD_TAG')
      await transaction.contactTag.createMany({
        data: [
          {
            contactId: context.contactId,
            projectId: context.projectId,
            source: 'automation',
            tagId,
          },
        ],
        skipDuplicates: true,
      });
    else
      await transaction.contactTag.deleteMany({
        where: { contactId: context.contactId, projectId: context.projectId, tagId },
      });
  }

  private async queueCrmOperation(
    transaction: RuntimeTransaction,
    node: ScenarioGraphNode,
    context: RuntimeContext,
    executionId: string,
  ): Promise<void> {
    const idempotencyKey = `crm-${executionId}-${node.id}`;
    if (
      await transaction.outboxRecord.findUnique({
        where: { projectId_idempotencyKey: { idempotencyKey, projectId: context.projectId } },
      })
    )
      return;
    const outbox = await transaction.outboxRecord.create({
      data: { idempotencyKey, kind: 'CRM', payload: {}, projectId: context.projectId },
    });
    const operation = await transaction.crmOperation.create({
      data: {
        contactId: context.contactId,
        inputSafe: { nodeId: node.id, scenarioExecutionId: executionId },
        normalizedEventId: context.normalizedEventId,
        outboxRecordId: outbox.id,
        projectId: context.projectId,
        type:
          node.type === 'CREATE_OR_UPDATE_LEAD'
            ? 'CREATE_OR_UPDATE_LEAD'
            : 'FORWARD_INBOUND_MESSAGE',
      },
    });
    await transaction.outboxRecord.update({
      data: { payload: { crmOperationId: operation.id } },
      where: { projectId_id: { id: outbox.id, projectId: context.projectId } },
    });
  }

  private async queueMessage(
    transaction: RuntimeTransaction,
    node: ScenarioGraphNode,
    context: RuntimeContext,
    executionId: string,
  ): Promise<void> {
    const templateVersionId =
      typeof node.config.templateVersionId === 'string' ? node.config.templateVersionId : undefined;
    const templateVersion = templateVersionId
      ? await transaction.messageTemplateVersion.findFirst({
          where: {
            id: templateVersionId,
            projectId: context.projectId,
            status: { in: ['PUBLISHED', 'SUPERSEDED'] },
            ...(typeof node.config.templateId === 'string'
              ? { templateId: node.config.templateId }
              : {}),
          },
        })
      : undefined;
    const templateContent = templateVersion?.content as
      | {
          caption?: string;
          inlineKeyboard?: Array<Array<{ callbackData?: string; text: string; url?: string }>>;
          text?: string;
        }
      | undefined;
    const sourceText =
      templateVersion?.kind === 'TEXT'
        ? templateContent?.text
        : templateVersion
          ? (templateContent?.caption ?? '')
          : typeof node.config.text === 'string'
            ? node.config.text
            : undefined;
    if (sourceText === undefined) return;
    const rendered = renderTemplate(sourceText, {
      contact: context.contactVariables,
      event: context.eventPayload,
    });
    if (rendered.missing.length) throw new Error('automation_template_variable_missing');
    const identity = await transaction.channelIdentity.findFirst({
      where: {
        connectionId: context.connectionId,
        contactId: context.contactId,
        projectId: context.projectId,
        status: 'ACTIVE',
      },
    });
    if (!identity) return;
    const idempotencyKey = `automation-${executionId}-${node.id}`;
    if (
      await transaction.outboxRecord.findUnique({
        where: { projectId_idempotencyKey: { idempotencyKey, projectId: context.projectId } },
      })
    )
      return;
    const message = await transaction.message.create({
      data: {
        connectionId: context.connectionId,
        contactId: context.contactId,
        content:
          templateVersion && templateVersion.kind !== 'TEXT'
            ? { caption: rendered.output }
            : { text: rendered.output },
        conversationId: context.conversationId,
        direction: 'OUTBOUND',
        mediaAssetId: templateVersion?.mediaAssetId ?? null,
        metadata: {
          source: 'automation',
          scenarioExecutionId: executionId,
          ...(templateContent?.inlineKeyboard
            ? { inlineKeyboard: templateContent.inlineKeyboard }
            : {}),
          ...(templateVersion
            ? {
                templateId: templateVersion.templateId,
                templateVersionId: templateVersion.id,
              }
            : {}),
        },
        projectId: context.projectId,
        status: 'QUEUED',
        type: templateVersion?.kind ?? 'TEXT',
      },
    });
    await transaction.outboxRecord.create({
      data: {
        connectionId: context.connectionId,
        idempotencyKey,
        nextAttemptAt: new Date(),
        payload: { channelIdentityId: identity.id, messageId: message.id },
        projectId: context.projectId,
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
    if (field === 'callback.data') return this.object(content ?? null).data ?? null;
    if (field?.startsWith('contact.customFields.'))
      return this.object(customFields)[field.slice(21)];
    return undefined;
  }

  private object(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }

  private contactVariables(contact: {
    customFields: Prisma.JsonValue;
    displayName: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    username: string | null;
  }): Record<string, Prisma.JsonValue> {
    return {
      customFields: contact.customFields,
      displayName: contact.displayName,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      username: contact.username,
    };
  }
}
