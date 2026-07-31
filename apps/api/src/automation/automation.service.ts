import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { scenarioGraphSchema, validateScenarioGraph } from '@omnicus/automation-core';
import type { Prisma } from '@omnicus/database';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { CreateScenarioDto, DuplicateScenarioDto, UpdateScenarioDto } from './dto';

@Injectable()
export class AutomationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(projectId: string) {
    return this.database.client.scenario.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        activeVersionId: true,
        createdAt: true,
        description: true,
        id: true,
        name: true,
        status: true,
        updatedAt: true,
      },
      where: { projectId, status: { not: 'ARCHIVED' } },
    });
  }

  async get(projectId: string, scenarioId: string) {
    const scenario = await this.database.client.scenario.findUnique({
      include: {
        activeVersion: true,
        draftVersion: true,
        versions: {
          orderBy: { version: 'desc' },
          select: {
            createdAt: true,
            id: true,
            publishedAt: true,
            status: true,
            validation: true,
            version: true,
          },
        },
      },
      where: { projectId_id: { id: scenarioId, projectId } },
    });
    if (!scenario)
      throw new NotFoundException({
        code: 'SCENARIO_NOT_FOUND',
        message: 'Scenario was not found',
      });
    return scenario;
  }

  async executions(projectId: string, scenarioId: string) {
    await this.get(projectId, scenarioId);
    return this.database.client.scenarioExecution.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        completedAt: true,
        createdAt: true,
        currentNodeId: true,
        failedAt: true,
        id: true,
        scenarioVersionId: true,
        status: true,
        triggerEventId: true,
        nodeExecutions: {
          orderBy: { startedAt: 'asc' },
          select: {
            attempt: true,
            completedAt: true,
            nodeId: true,
            nodeType: true,
            startedAt: true,
            status: true,
          },
        },
      },
      take: 100,
      where: { projectId, scenarioId },
    });
  }

  async create(
    projectId: string,
    dto: CreateScenarioDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const validation = this.assertValidGraph(dto.graph);
    return this.database.client.$transaction(async (transaction) => {
      const scenario = await transaction.scenario.create({
        data: { description: dto.description ?? null, name: dto.name, projectId },
      });
      const draft = await transaction.scenarioVersion.create({
        data: {
          contentHash: this.hash(dto.graph),
          graph: this.toJson(dto.graph),
          projectId,
          scenarioId: scenario.id,
          validation: this.toJson(validation),
          version: 1,
        },
      });
      const created = await transaction.scenario.update({
        data: { draftVersionId: draft.id },
        where: { projectId_id: { id: scenario.id, projectId } },
      });
      await this.audit.record({
        action: 'scenario.created',
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: created.id,
        entityType: 'Scenario',
        projectId,
        afterSafeJson: { name: created.name, version: 1 },
      });
      return created;
    });
  }

  async update(
    projectId: string,
    scenarioId: string,
    dto: UpdateScenarioDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const scenario = await this.get(projectId, scenarioId);
    const graph =
      dto.graph ?? (scenario.draftVersion?.graph as Record<string, unknown> | undefined);
    if (!graph)
      throw new BadRequestException({
        code: 'SCENARIO_DRAFT_REQUIRED',
        message: 'A scenario draft is required',
      });
    const validation = this.assertValidGraph(graph);
    return this.database.client.$transaction(async (transaction) => {
      let draftId = scenario.draftVersionId;
      if (!draftId) {
        const latest = await transaction.scenarioVersion.aggregate({
          _max: { version: true },
          where: { projectId, scenarioId },
        });
        const draft = await transaction.scenarioVersion.create({
          data: {
            contentHash: this.hash(graph),
            graph: this.toJson(graph),
            projectId,
            scenarioId,
            validation: this.toJson(validation),
            version: (latest._max.version ?? 0) + 1,
          },
        });
        draftId = draft.id;
      } else {
        await transaction.scenarioVersion.update({
          data: {
            contentHash: this.hash(graph),
            graph: this.toJson(graph),
            validation: this.toJson(validation),
          },
          where: { projectId_id: { id: draftId, projectId } },
        });
      }
      const updated = await transaction.scenario.update({
        data: {
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.name === undefined ? {} : { name: dto.name }),
          draftVersionId: draftId,
        },
        where: { projectId_id: { id: scenarioId, projectId } },
      });
      await this.audit.record({
        action: 'scenario.updated',
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: scenarioId,
        entityType: 'Scenario',
        projectId,
        afterSafeJson: { draftVersionId: draftId },
      });
      return updated;
    });
  }

  async publish(
    projectId: string,
    scenarioId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const scenario = await this.get(projectId, scenarioId);
    if (!scenario.draftVersion)
      throw new BadRequestException({
        code: 'SCENARIO_DRAFT_REQUIRED',
        message: 'A scenario draft is required',
      });
    const draftVersion = scenario.draftVersion;
    const validation = this.assertValidGraph(draftVersion.graph);
    await this.assertPinnedTemplates(projectId, draftVersion.graph);
    await this.assertPinnedSubflows(projectId, scenarioId, draftVersion.graph);
    return this.database.client.$transaction(async (transaction) => {
      if (scenario.activeVersionId)
        await transaction.scenarioVersion.update({
          data: { status: 'SUPERSEDED' },
          where: { projectId_id: { id: scenario.activeVersionId, projectId } },
        });
      await transaction.scenarioVersion.update({
        data: {
          compiledDefinition: this.toJson(draftVersion.graph),
          publishedAt: new Date(),
          status: 'PUBLISHED',
          validation: this.toJson(validation),
        },
        where: { projectId_id: { id: draftVersion.id, projectId } },
      });
      const published = await transaction.scenario.update({
        data: {
          activeVersionId: draftVersion.id,
          draftVersionId: null,
          status: 'PUBLISHED',
        },
        where: { projectId_id: { id: scenarioId, projectId } },
      });
      await this.audit.record({
        action: 'scenario.published',
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: scenarioId,
        entityType: 'Scenario',
        projectId,
        afterSafeJson: { activeVersionId: draftVersion.id },
      });
      return published;
    });
  }

  async setStatus(
    projectId: string,
    scenarioId: string,
    status: 'PAUSED' | 'PUBLISHED',
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const scenario = await this.get(projectId, scenarioId);
    if (status === 'PUBLISHED' && !scenario.activeVersionId)
      throw new BadRequestException({
        code: 'SCENARIO_ACTIVE_VERSION_REQUIRED',
        message: 'An active version is required',
      });
    const updated = await this.database.client.scenario.update({
      data: { status },
      where: { projectId_id: { id: scenarioId, projectId } },
    });
    await this.audit.record({
      action: status === 'PAUSED' ? 'scenario.paused' : 'scenario.resumed',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: scenarioId,
      entityType: 'Scenario',
      projectId,
      afterSafeJson: { status },
    });
    return updated;
  }

  async archive(
    projectId: string,
    scenarioId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    await this.get(projectId, scenarioId);
    const archived = await this.database.client.scenario.update({
      data: { status: 'ARCHIVED' },
      where: { projectId_id: { id: scenarioId, projectId } },
    });
    await this.audit.record({
      action: 'scenario.archived',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: scenarioId,
      entityType: 'Scenario',
      projectId,
      afterSafeJson: { status: archived.status },
    });
    return archived;
  }

  async duplicate(
    projectId: string,
    scenarioId: string,
    dto: DuplicateScenarioDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const source = await this.get(projectId, scenarioId);
    const sourceVersion = source.draftVersion ?? source.activeVersion;
    if (!sourceVersion)
      throw new BadRequestException({
        code: 'SCENARIO_VERSION_REQUIRED',
        message: 'Scenario has no version',
      });
    return this.database.client.$transaction(async (transaction) => {
      const scenario = await transaction.scenario.create({
        data: { description: source.description, name: dto.name, projectId },
      });
      const graph = sourceVersion.graph as Prisma.InputJsonValue;
      const draft = await transaction.scenarioVersion.create({
        data: {
          contentHash: this.hash(graph),
          graph,
          projectId,
          scenarioId: scenario.id,
          validation: sourceVersion.validation as Prisma.InputJsonValue,
          version: 1,
        },
      });
      const duplicated = await transaction.scenario.update({
        data: { draftVersionId: draft.id },
        where: { projectId_id: { id: scenario.id, projectId } },
      });
      await this.audit.record({
        action: 'scenario.duplicated',
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: duplicated.id,
        entityType: 'Scenario',
        projectId,
        afterSafeJson: { sourceScenarioId: scenarioId },
      });
      return duplicated;
    });
  }

  async restoreVersion(
    projectId: string,
    scenarioId: string,
    versionId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    await this.get(projectId, scenarioId);
    const source = await this.database.client.scenarioVersion.findFirst({
      where: { id: versionId, projectId, scenarioId },
    });
    if (!source)
      throw new NotFoundException({
        code: 'SCENARIO_VERSION_NOT_FOUND',
        message: 'Scenario version was not found',
      });
    return this.update(
      projectId,
      scenarioId,
      { graph: source.graph as Record<string, unknown> },
      actor,
      context,
    );
  }

  private assertValidGraph(graph: unknown) {
    const validation = validateScenarioGraph(graph);
    if (validation.errors.length)
      throw new BadRequestException({
        code: 'SCENARIO_GRAPH_INVALID',
        message: 'Scenario graph is invalid',
      });
    return validation;
  }

  private async assertPinnedTemplates(projectId: string, graph: unknown): Promise<void> {
    const parsed = scenarioGraphSchema.safeParse(graph);
    if (!parsed.success) return;
    for (const node of parsed.data.nodes.filter(
      (candidate) => candidate.type === 'SEND_TEMPLATE',
    )) {
      const templateId = node.config.templateId;
      const templateVersionId = node.config.templateVersionId;
      if (typeof templateId !== 'string' || typeof templateVersionId !== 'string') continue;
      const version = await this.database.client.messageTemplateVersion.findFirst({
        where: {
          id: templateVersionId,
          projectId,
          status: 'PUBLISHED',
          templateId,
          template: { status: 'PUBLISHED' },
        },
      });
      if (!version)
        throw new BadRequestException({
          code: 'SCENARIO_TEMPLATE_VERSION_INVALID',
          message: 'Scenario references an unavailable template version',
        });
    }
  }

  private async assertPinnedSubflows(
    projectId: string,
    sourceScenarioId: string,
    graph: unknown,
  ): Promise<void> {
    const parsed = scenarioGraphSchema.safeParse(graph);
    if (!parsed.success) return;
    for (const node of parsed.data.nodes.filter(
      (candidate) => candidate.type === 'START_SUBFLOW',
    )) {
      const scenarioId = node.config.scenarioId;
      const scenarioVersionId = node.config.scenarioVersionId;
      if (typeof scenarioId !== 'string' || typeof scenarioVersionId !== 'string') continue;
      if (scenarioId === sourceScenarioId)
        throw new BadRequestException({
          code: 'SCENARIO_SUBFLOW_SELF_REFERENCE',
          message: 'A scenario cannot start itself as a subflow',
        });
      const version = await this.database.client.scenarioVersion.findFirst({
        where: {
          id: scenarioVersionId,
          projectId,
          scenarioId,
          status: 'PUBLISHED',
        },
      });
      if (!version)
        throw new BadRequestException({
          code: 'SCENARIO_SUBFLOW_VERSION_INVALID',
          message: 'Scenario references an unavailable subflow version',
        });
    }
  }

  private hash(graph: unknown): string {
    return createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
