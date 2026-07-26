import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { validateScenarioGraph } from '@omnicus/automation-core';
import type { Prisma } from '@omnicus/database';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { CreateScenarioDto, UpdateScenarioDto } from './dto';

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
      where: { projectId },
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
      include: {
        nodeExecutions: {
          orderBy: { startedAt: 'asc' },
          select: { completedAt: true, nodeId: true, nodeType: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
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

  private assertValidGraph(graph: unknown) {
    const validation = validateScenarioGraph(graph);
    if (validation.errors.length)
      throw new BadRequestException({
        code: 'SCENARIO_GRAPH_INVALID',
        message: 'Scenario graph is invalid',
      });
    return validation;
  }

  private hash(graph: unknown): string {
    return createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
