import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@omnicus/database';
import {
  type TelegramInlineKeyboard,
  validateTelegramInlineKeyboard,
} from '@omnicus/channel-telegram';
import { renderTemplate, templateVariables } from '@omnicus/media-core';

import { AuditService } from '../audit/audit.service';
import type { RequestSecurityContext } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import type {
  CreateMessageTemplateDto,
  PreviewMessageTemplateDto,
  UpdateMessageTemplateDto,
} from './dto';

type TemplateInput = {
  caption?: string;
  inlineKeyboard?: TelegramInlineKeyboard;
  kind: 'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'TEXT' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE';
  mediaAssetId?: string;
  text?: string;
};

const safeMediaAssetSelect = {
  detectedMimeType: true,
  id: true,
  kind: true,
  originalFilename: true,
  status: true,
} as const;

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(projectId: string, archived = false) {
    return this.database.client.messageTemplate.findMany({
      include: {
        activeVersion: { include: { mediaAsset: { select: safeMediaAssetSelect } } },
        draftVersion: { include: { mediaAsset: { select: safeMediaAssetSelect } } },
      },
      orderBy: { updatedAt: 'desc' },
      where: { projectId, status: archived ? 'ARCHIVED' : { not: 'ARCHIVED' } },
    });
  }

  async get(projectId: string, templateId: string) {
    const template = await this.database.client.messageTemplate.findUnique({
      include: {
        activeVersion: { include: { mediaAsset: { select: safeMediaAssetSelect } } },
        draftVersion: { include: { mediaAsset: { select: safeMediaAssetSelect } } },
        versions: {
          orderBy: { version: 'desc' },
          select: {
            content: true,
            createdAt: true,
            id: true,
            kind: true,
            mediaAssetId: true,
            publishedAt: true,
            status: true,
            variables: true,
            version: true,
          },
        },
      },
      where: { projectId_id: { id: templateId, projectId } },
    });
    if (!template)
      throw new NotFoundException({
        code: 'MESSAGE_TEMPLATE_NOT_FOUND',
        message: 'Message template was not found',
      });
    return template;
  }

  async create(
    projectId: string,
    dto: CreateMessageTemplateDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const input = this.input(dto);
    await this.validateMedia(projectId, input);
    const content = this.content(input);
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const template = await transaction.messageTemplate.create({
          data: {
            createdById: actor.userId,
            description: dto.description ?? null,
            name: dto.name.trim(),
            projectId,
          },
        });
        const draft = await transaction.messageTemplateVersion.create({
          data: {
            content,
            contentHash: this.hash(input),
            createdById: actor.userId,
            kind: input.kind,
            mediaAssetId: input.mediaAssetId ?? null,
            projectId,
            templateId: template.id,
            variables: templateVariables(input.text ?? input.caption ?? ''),
            version: 1,
          },
        });
        const created = await transaction.messageTemplate.update({
          data: { draftVersionId: draft.id },
          where: { projectId_id: { id: template.id, projectId } },
        });
        await this.audit.record({
          action: 'message_template.created',
          actorUserId: actor.userId,
          afterSafeJson: { kind: input.kind, version: 1 },
          correlationId: context.correlationId,
          entityId: template.id,
          entityType: 'MessageTemplate',
          projectId,
        });
        return created;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')
        throw new ConflictException({
          code: 'MESSAGE_TEMPLATE_NAME_EXISTS',
          message: 'A template with this name already exists',
        });
      throw error;
    }
  }

  async update(
    projectId: string,
    templateId: string,
    dto: UpdateMessageTemplateDto,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const template = await this.get(projectId, templateId);
    if (template.status === 'ARCHIVED')
      throw new ConflictException({
        code: 'MESSAGE_TEMPLATE_ARCHIVED',
        message: 'Archived template cannot be edited',
      });
    const source = template.draftVersion ?? template.activeVersion;
    if (!source)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_VERSION_REQUIRED',
        message: 'Template version is missing',
      });
    const sourceContent = source.content as {
      caption?: string;
      inlineKeyboard?: TelegramInlineKeyboard;
      text?: string;
    };
    const input: TemplateInput = this.input({
      kind: dto.kind ?? source.kind,
      ...(dto.text !== undefined || sourceContent.text !== undefined
        ? { text: dto.text ?? sourceContent.text }
        : {}),
      ...(dto.caption !== undefined || sourceContent.caption !== undefined
        ? { caption: dto.caption ?? sourceContent.caption }
        : {}),
      ...(dto.inlineKeyboard !== undefined || sourceContent.inlineKeyboard !== undefined
        ? {
            inlineKeyboard: dto.inlineKeyboard ?? sourceContent.inlineKeyboard,
          }
        : {}),
      ...(dto.mediaAssetId !== undefined
        ? { mediaAssetId: dto.mediaAssetId }
        : source.mediaAssetId
          ? { mediaAssetId: source.mediaAssetId }
          : {}),
      name: dto.name ?? template.name,
    });
    await this.validateMedia(projectId, input);
    const content = this.content(input);
    return this.database.client.$transaction(async (transaction) => {
      let draftId = template.draftVersionId;
      if (!draftId) {
        const latestVersion = Math.max(...template.versions.map((version) => version.version), 0);
        const draft = await transaction.messageTemplateVersion.create({
          data: {
            content,
            contentHash: this.hash(input),
            createdById: actor.userId,
            kind: input.kind,
            mediaAssetId: input.mediaAssetId ?? null,
            projectId,
            templateId,
            variables: templateVariables(input.text ?? input.caption ?? ''),
            version: latestVersion + 1,
          },
        });
        draftId = draft.id;
      } else {
        await transaction.messageTemplateVersion.update({
          data: {
            content,
            contentHash: this.hash(input),
            kind: input.kind,
            mediaAssetId: input.mediaAssetId ?? null,
            variables: templateVariables(input.text ?? input.caption ?? ''),
          },
          where: { projectId_id: { id: draftId, projectId } },
        });
      }
      const updated = await transaction.messageTemplate.update({
        data: {
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          draftVersionId: draftId,
        },
        where: { projectId_id: { id: templateId, projectId } },
      });
      await this.audit.record({
        action: 'message_template.updated',
        actorUserId: actor.userId,
        afterSafeJson: { draftVersionId: draftId, kind: input.kind },
        correlationId: context.correlationId,
        entityId: templateId,
        entityType: 'MessageTemplate',
        projectId,
      });
      return updated;
    });
  }

  async publish(
    projectId: string,
    templateId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const template = await this.get(projectId, templateId);
    if (!template.draftVersion)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_DRAFT_REQUIRED',
        message: 'Template draft is required',
      });
    await this.validateMedia(projectId, {
      kind: template.draftVersion.kind,
      ...(template.draftVersion.mediaAssetId
        ? { mediaAssetId: template.draftVersion.mediaAssetId }
        : {}),
      ...(template.draftVersion.content as { caption?: string; text?: string }),
    });
    return this.database.client.$transaction(async (transaction) => {
      if (template.activeVersionId)
        await transaction.messageTemplateVersion.update({
          data: { status: 'SUPERSEDED' },
          where: { projectId_id: { id: template.activeVersionId, projectId } },
        });
      await transaction.messageTemplateVersion.update({
        data: { publishedAt: new Date(), status: 'PUBLISHED' },
        where: { projectId_id: { id: template.draftVersion!.id, projectId } },
      });
      const published = await transaction.messageTemplate.update({
        data: {
          activeVersionId: template.draftVersion!.id,
          draftVersionId: null,
          status: 'PUBLISHED',
        },
        where: { projectId_id: { id: templateId, projectId } },
      });
      await this.audit.record({
        action: 'message_template.published',
        actorUserId: actor.userId,
        afterSafeJson: { activeVersionId: template.draftVersion!.id },
        correlationId: context.correlationId,
        entityId: templateId,
        entityType: 'MessageTemplate',
        projectId,
      });
      return published;
    });
  }

  async archive(
    projectId: string,
    templateId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    await this.get(projectId, templateId);
    const archived = await this.database.client.messageTemplate.update({
      data: { status: 'ARCHIVED' },
      where: { projectId_id: { id: templateId, projectId } },
    });
    await this.audit.record({
      action: 'message_template.archived',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: templateId,
      entityType: 'MessageTemplate',
      projectId,
    });
    return archived;
  }

  async restore(
    projectId: string,
    templateId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const template = await this.get(projectId, templateId);
    if (template.status !== 'ARCHIVED')
      throw new ConflictException({
        code: 'MESSAGE_TEMPLATE_NOT_ARCHIVED',
        message: 'Message template is not archived',
      });
    const restored = await this.database.client.messageTemplate.update({
      data: { status: template.activeVersionId ? 'PUBLISHED' : 'DRAFT' },
      where: { projectId_id: { id: templateId, projectId } },
    });
    await this.audit.record({
      action: 'message_template.restored',
      actorUserId: actor.userId,
      afterSafeJson: { status: restored.status },
      correlationId: context.correlationId,
      entityId: templateId,
      entityType: 'MessageTemplate',
      projectId,
    });
    return restored;
  }

  async preview(projectId: string, templateId: string, dto: PreviewMessageTemplateDto) {
    const template = await this.get(projectId, templateId);
    const version = template.draftVersion ?? template.activeVersion;
    if (!version)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_VERSION_REQUIRED',
        message: 'Template version is missing',
      });
    const content = version.content as { caption?: string; text?: string };
    const rendered = renderTemplate(content.text ?? content.caption ?? '', dto.variables ?? {});
    return { kind: version.kind, mediaAssetId: version.mediaAssetId, ...rendered };
  }

  private input(
    dto: Omit<TemplateInput, 'inlineKeyboard'> & {
      inlineKeyboard?: unknown;
      name: string;
    },
  ): TemplateInput {
    if (dto.kind === 'TEXT' && !dto.text)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_TEXT_REQUIRED',
        message: 'Text template requires text',
      });
    if (dto.kind !== 'TEXT' && !dto.mediaAssetId)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_MEDIA_REQUIRED',
        message: 'Media template requires an asset',
      });
    if (dto.kind === 'VIDEO_NOTE' && dto.caption)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_VIDEO_NOTE_CAPTION_UNSUPPORTED',
        message: 'Video note templates cannot have a caption',
      });
    let inlineKeyboard: TelegramInlineKeyboard | undefined;
    if (dto.inlineKeyboard !== undefined)
      try {
        inlineKeyboard = validateTelegramInlineKeyboard(dto.inlineKeyboard);
      } catch {
        throw new BadRequestException({
          code: 'MESSAGE_TEMPLATE_INLINE_KEYBOARD_INVALID',
          message: 'Inline keyboard is invalid',
        });
      }
    return {
      kind: dto.kind,
      ...(inlineKeyboard === undefined ? {} : { inlineKeyboard }),
      ...(dto.kind === 'TEXT'
        ? { text: dto.text! }
        : {
            caption: dto.caption ?? '',
            mediaAssetId: dto.mediaAssetId!,
          }),
    };
  }

  private async validateMedia(projectId: string, input: TemplateInput): Promise<void> {
    if (input.kind === 'TEXT') return;
    if (!input.mediaAssetId)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_MEDIA_REQUIRED',
        message: 'Media template requires an asset',
      });
    const asset = await this.database.client.mediaAsset.findFirst({
      where: {
        id: input.mediaAssetId,
        kind: input.kind,
        projectId,
        status: 'AVAILABLE',
      },
    });
    if (!asset)
      throw new BadRequestException({
        code: 'MESSAGE_TEMPLATE_MEDIA_INVALID',
        message: 'Template media is unavailable or has the wrong type',
      });
  }

  private content(input: TemplateInput): Prisma.InputJsonValue {
    return (input.kind === 'TEXT'
      ? {
          text: input.text!,
          ...(input.inlineKeyboard === undefined ? {} : { inlineKeyboard: input.inlineKeyboard }),
        }
      : {
          caption: input.caption ?? '',
          mediaAssetId: input.mediaAssetId!,
          ...(input.inlineKeyboard === undefined ? {} : { inlineKeyboard: input.inlineKeyboard }),
        }) as unknown as Prisma.InputJsonValue;
  }

  private hash(input: TemplateInput): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
}
