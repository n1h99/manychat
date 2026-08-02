import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { executeExternalHttpRequest, ExternalHttpError } from '@omnicus/automation-http';
import { externalHttpRequestConfigSchema, scenarioGraphSchema } from '@omnicus/automation-core';
import { ChannelSecretsService, type EncryptedSecretEnvelope } from '@omnicus/channel-secrets';
import type { ApiEnvironment } from '@omnicus/config/server';
import { Prisma } from '@omnicus/database';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type {
  CreateAutomationSecretDto,
  TestExternalHttpRequestDto,
  UpdateAutomationSecretDto,
} from './automation-http.dto';

@Injectable()
export class AutomationHttpService {
  private readonly secrets: ChannelSecretsService;

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConfigService) config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.secrets = new ChannelSecretsService(config.get('CHANNEL_SECRETS_KEY', { infer: true }));
  }

  async listSecrets(projectId: string) {
    return this.database.client.automationSecret.findMany({
      orderBy: { name: 'asc' },
      select: { createdAt: true, id: true, name: true, updatedAt: true },
      where: { archivedAt: null, projectId },
    });
  }

  async createSecret(
    projectId: string,
    dto: CreateAutomationSecretDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const id = randomUUID();
    const name = dto.name.trim();
    if (!name)
      throw new BadRequestException({
        code: 'AUTOMATION_SECRET_NAME_INVALID',
        message: 'Automation secret name must not be blank',
      });
    const normalizedName = this.normalizedName(name);
    try {
      const created = await this.database.client.automationSecret.create({
        data: {
          id,
          name,
          normalizedName,
          projectId,
          valueEncrypted: this.encrypt(
            projectId,
            id,
            dto.value,
          ) as unknown as Prisma.InputJsonValue,
        },
        select: { createdAt: true, id: true, name: true, updatedAt: true },
      });
      await this.audit.record({
        action: 'automation.secret.created',
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: id,
        entityType: 'AutomationSecret',
        projectId,
        afterSafeJson: { name },
      });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'AUTOMATION_SECRET_NAME_CONFLICT',
          message: 'An automation secret with this name already exists',
        });
      throw error;
    }
  }

  async updateSecret(
    projectId: string,
    secretId: string,
    dto: UpdateAutomationSecretDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const existing = await this.secret(projectId, secretId);
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name)
      throw new BadRequestException({
        code: 'AUTOMATION_SECRET_NAME_INVALID',
        message: 'Automation secret name must not be blank',
      });
    let updated;
    try {
      updated = await this.database.client.automationSecret.update({
        data: {
          ...(name ? { name, normalizedName: this.normalizedName(name) } : {}),
          ...(dto.value === undefined
            ? {}
            : {
                valueEncrypted: this.encrypt(
                  projectId,
                  existing.id,
                  dto.value,
                ) as unknown as Prisma.InputJsonValue,
              }),
        },
        select: { createdAt: true, id: true, name: true, updatedAt: true },
        where: { projectId_id: { id: secretId, projectId } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'AUTOMATION_SECRET_NAME_CONFLICT',
          message: 'An automation secret with this name already exists',
        });
      throw error;
    }
    await this.audit.record({
      action: 'automation.secret.rotated',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: secretId,
      entityType: 'AutomationSecret',
      projectId,
      afterSafeJson: { name: updated.name, valueRotated: dto.value !== undefined },
    });
    return updated;
  }

  async archiveSecret(
    projectId: string,
    secretId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    await this.secret(projectId, secretId);
    const scenarios = await this.database.client.scenario.findMany({
      include: {
        activeVersion: { select: { graph: true } },
        draftVersion: { select: { graph: true } },
      },
      where: { projectId, status: { not: 'ARCHIVED' } },
    });
    if (
      scenarios.some((scenario) =>
        [scenario.activeVersion?.graph, scenario.draftVersion?.graph].some((graph) =>
          this.graphSecretIds(graph).has(secretId),
        ),
      )
    )
      throw new ConflictException({
        code: 'AUTOMATION_SECRET_IN_USE',
        message: 'Automation secret is referenced by a scenario version',
      });
    await this.database.client.automationSecret.update({
      data: { archivedAt: new Date() },
      where: { projectId_id: { id: secretId, projectId } },
    });
    await this.audit.record({
      action: 'automation.secret.archived',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: secretId,
      entityType: 'AutomationSecret',
      projectId,
      afterSafeJson: { archived: true },
    });
    return { archived: true, id: secretId };
  }

  async testRequest(
    projectId: string,
    dto: TestExternalHttpRequestDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const config = externalHttpRequestConfigSchema.safeParse(dto.config);
    if (!config.success)
      throw new BadRequestException({
        code: 'EXTERNAL_HTTP_CONFIG_INVALID',
        message: 'External HTTP request configuration is invalid',
      });
    let result;
    try {
      result = await executeExternalHttpRequest({
        config: config.data,
        idempotencyKey: `test-${randomUUID()}`,
        secretFor: (secretId) => this.secretValue(projectId, secretId),
        variables: dto.variables ?? {},
      });
    } catch (error) {
      if (!(error instanceof ExternalHttpError)) throw error;
      await this.audit.record({
        action: 'automation.http.test_failed',
        actorUserId: actor.userId,
        correlationId: context.correlationId,
        entityId: projectId,
        entityType: 'Project',
        projectId,
        afterSafeJson: { errorCode: error.safeCode, outcome: error.outcome },
      });
      const body = {
        code: error.safeCode,
        message: 'External HTTP test could not be completed safely',
      };
      if (error.outcome === 'PERMANENT_FAILURE') throw new BadRequestException(body);
      throw new ServiceUnavailableException(body);
    }
    const preview = JSON.stringify(result.data) ?? 'null';
    await this.audit.record({
      action: 'automation.http.test_completed',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: projectId,
      entityType: 'Project',
      projectId,
      afterSafeJson: {
        method: config.data.method,
        outcome: result.outcome,
        sizeBytes: result.sizeBytes,
        statusCode: result.statusCode,
      },
    });
    return {
      contentType: result.contentType,
      data: preview.length <= 128 * 1024 ? result.data : null,
      mappingKeys: result.mappingKeys,
      outcome: result.outcome,
      previewTruncated: preview.length > 128 * 1024,
      sizeBytes: result.sizeBytes,
      statusCode: result.statusCode,
    };
  }

  private async secret(projectId: string, secretId: string) {
    const secret = await this.database.client.automationSecret.findFirst({
      where: { archivedAt: null, id: secretId, projectId },
    });
    if (!secret)
      throw new NotFoundException({
        code: 'AUTOMATION_SECRET_NOT_FOUND',
        message: 'Automation secret was not found',
      });
    return secret;
  }

  private async secretValue(projectId: string, secretId: string): Promise<string> {
    const secret = await this.secret(projectId, secretId);
    return this.secrets.decryptSecret({
      channelConnectionId: secret.id,
      channelType: 'automation',
      envelope: secret.valueEncrypted as unknown as EncryptedSecretEnvelope,
      field: 'value',
      projectId,
    });
  }

  private encrypt(projectId: string, secretId: string, value: string): EncryptedSecretEnvelope {
    return this.secrets.encryptSecret({
      channelConnectionId: secretId,
      channelType: 'automation',
      field: 'value',
      plaintext: value,
      projectId,
    });
  }

  private graphSecretIds(graph: unknown): Set<string> {
    const parsed = scenarioGraphSchema.safeParse(graph);
    if (!parsed.success) return new Set();
    return new Set(
      parsed.data.nodes
        .filter((node) => node.type === 'EXTERNAL_HTTP_REQUEST')
        .flatMap((node) => (Array.isArray(node.config.headers) ? node.config.headers : []))
        .flatMap((header) => {
          if (!header || typeof header !== 'object' || Array.isArray(header)) return [];
          const secretId = (header as Record<string, unknown>).secretId;
          return typeof secretId === 'string' ? [secretId] : [];
        }),
    );
  }

  private normalizedName(name: string): string {
    return name.normalize('NFKC').toLocaleLowerCase('en-US');
  }
}
