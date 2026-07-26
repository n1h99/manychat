import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CustomFieldType } from '@omnicus/database';

import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { RequestSecurityContext } from '../auth/auth.service';
import type {
  AddTagDto,
  BulkTagsDto,
  ContactsQueryDto,
  CreateCustomFieldDto,
  CreateTagDto,
  UpdateContactDto,
  UpdateCustomFieldDto,
  UpdateTagDto,
} from './dto';

const contactSelect = {
  automationMode: true,
  createdAt: true,
  crmContactId: true,
  crmLeadId: true,
  crmManagerId: true,
  customFields: true,
  displayName: true,
  email: true,
  firstName: true,
  id: true,
  lastInteractionAt: true,
  lastName: true,
  phone: true,
  projectId: true,
  status: true,
  updatedAt: true,
  username: true,
} as const;

@Injectable()
export class ContactsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(projectId: string, query: ContactsQueryDto) {
    const where: Prisma.ContactWhereInput = {
      projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel
        ? { channelIdentities: { some: { channel: query.channel as never } } }
        : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
      ...(query.hasCrmLeadId === 'true' ? { crmLeadId: { not: null } } : {}),
      ...(query.hasCrmLeadId === 'false' ? { crmLeadId: null } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.contact.findMany({
        include: {
          channelIdentities: { select: { channel: true } },
          tags: { include: { tag: true } },
        },
        orderBy: { [query.sortBy]: query.sortDirection },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
      this.database.client.contact.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async get(projectId: string, contactId: string) {
    const contact = await this.database.client.contact.findUnique({
      include: {
        channelIdentities: true,
        tags: { include: { tag: true } },
      },
      where: { projectId_id: { id: contactId, projectId } },
    });
    if (!contact)
      throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact was not found' });
    return contact;
  }

  async update(
    projectId: string,
    contactId: string,
    input: UpdateContactDto,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    const before = await this.get(projectId, contactId);
    if (input.customFields) await this.assertCustomFields(projectId, input.customFields);
    const contact = await this.database.client.contact.update({
      data: {
        ...(input.automationMode === undefined ? {} : { automationMode: input.automationMode }),
        ...(input.customFields === undefined
          ? {}
          : { customFields: input.customFields as Prisma.InputJsonValue }),
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
        ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.status === undefined
          ? {}
          : { archivedAt: input.status === 'ARCHIVED' ? new Date() : null, status: input.status }),
        ...(input.username === undefined ? {} : { username: input.username }),
      },
      select: contactSelect,
      where: { projectId_id: { id: contactId, projectId } },
    });
    await this.audit.record({
      action:
        input.automationMode !== undefined
          ? 'contact.automation_mode_changed'
          : input.status !== undefined
            ? 'contact.status_changed'
            : input.customFields !== undefined
              ? 'custom_field.value_changed'
              : 'contact.updated',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      afterSafeJson: { automationMode: contact.automationMode, status: contact.status },
      beforeSafeJson: { automationMode: before.automationMode, status: before.status },
      correlationId: context.correlationId,
      entityId: contactId,
      entityType: 'Contact',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return contact;
  }

  async timeline(projectId: string, contactId: string) {
    const contact = await this.get(projectId, contactId);
    const audit = await this.database.client.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      where: { entityId: contactId, entityType: 'Contact', projectId },
    });
    return { audit, createdAt: contact.createdAt };
  }

  async listTags(projectId: string) {
    return this.database.client.tag.findMany({
      orderBy: { name: 'asc' },
      where: { archivedAt: null, projectId },
    });
  }

  async createTag(
    projectId: string,
    input: CreateTagDto,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    const normalizedName = input.name.trim().toLocaleLowerCase('en-US');
    try {
      const tag = await this.database.client.tag.create({
        data: {
          color: input.color ?? null,
          description: input.description ?? null,
          name: input.name.trim(),
          normalizedName,
          projectId,
        },
      });
      await this.audit.record({
        action: 'tag.created',
        actorEmailSnapshot: context.actorEmail,
        actorUserId: context.actorUserId,
        afterSafeJson: { name: tag.name },
        correlationId: context.correlationId,
        entityId: tag.id,
        entityType: 'Tag',
        ip: context.ip,
        projectId,
        userAgent: context.userAgent,
      });
      return tag;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'TAG_NAME_EXISTS',
          message: 'Tag name already exists',
        });
      throw error;
    }
  }

  async updateTag(
    projectId: string,
    tagId: string,
    input: UpdateTagDto,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    await this.assertTag(projectId, tagId);
    const tag = await this.database.client.tag.update({
      data: {
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.name === undefined
          ? {}
          : {
              name: input.name.trim(),
              normalizedName: input.name.trim().toLocaleLowerCase('en-US'),
            }),
      },
      where: { projectId_id: { id: tagId, projectId } },
    });
    await this.audit.record({
      action: 'tag.updated',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      correlationId: context.correlationId,
      entityId: tagId,
      entityType: 'Tag',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return tag;
  }

  async archiveTag(
    projectId: string,
    tagId: string,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    await this.assertTag(projectId, tagId);
    await this.database.client.tag.update({
      data: { archivedAt: new Date() },
      where: { projectId_id: { id: tagId, projectId } },
    });
    await this.audit.record({
      action: 'tag.deleted',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      correlationId: context.correlationId,
      entityId: tagId,
      entityType: 'Tag',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }

  async addTag(
    projectId: string,
    contactId: string,
    input: AddTagDto,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    await Promise.all([this.get(projectId, contactId), this.assertTag(projectId, input.tagId)]);
    const result = await this.database.client.contactTag.createMany({
      data: { contactId, projectId, source: 'MANUAL', tagId: input.tagId },
      skipDuplicates: true,
    });
    if (result.count)
      await this.audit.record({
        action: 'contact.tag_added',
        actorEmailSnapshot: context.actorEmail,
        actorUserId: context.actorUserId,
        correlationId: context.correlationId,
        entityId: contactId,
        entityType: 'Contact',
        ip: context.ip,
        projectId,
        userAgent: context.userAgent,
      });
  }

  async removeTag(
    projectId: string,
    contactId: string,
    tagId: string,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    const result = await this.database.client.contactTag.deleteMany({
      where: { contactId, projectId, tagId },
    });
    if (result.count)
      await this.audit.record({
        action: 'contact.tag_removed',
        actorEmailSnapshot: context.actorEmail,
        actorUserId: context.actorUserId,
        correlationId: context.correlationId,
        entityId: contactId,
        entityType: 'Contact',
        ip: context.ip,
        projectId,
        userAgent: context.userAgent,
      });
  }

  async bulkTags(
    projectId: string,
    input: BulkTagsDto,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    const [contacts, tags] = await Promise.all([
      this.database.client.contact.count({ where: { id: { in: input.contactIds }, projectId } }),
      this.database.client.tag.count({
        where: { archivedAt: null, id: { in: input.tagIds }, projectId },
      }),
    ]);
    if (contacts !== new Set(input.contactIds).size || tags !== new Set(input.tagIds).size)
      throw new NotFoundException({
        code: 'PROJECT_RESOURCE_NOT_FOUND',
        message: 'Contact or tag was not found',
      });
    if (input.add)
      await this.database.client.contactTag.createMany({
        data: input.contactIds.flatMap((contactId) =>
          input.tagIds.map((tagId) => ({ contactId, projectId, source: 'MANUAL_BULK', tagId })),
        ),
        skipDuplicates: true,
      });
    else
      await this.database.client.contactTag.deleteMany({
        where: { contactId: { in: input.contactIds }, projectId, tagId: { in: input.tagIds } },
      });
    await this.audit.record({
      action: 'contact.bulk_tags',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      afterSafeJson: {
        add: input.add,
        contactCount: input.contactIds.length,
        tagCount: input.tagIds.length,
      },
      correlationId: context.correlationId,
      entityType: 'Contact',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }

  async listCustomFields(projectId: string) {
    return this.database.client.customFieldDefinition.findMany({
      orderBy: { name: 'asc' },
      where: { archivedAt: null, projectId },
    });
  }

  async createCustomField(
    projectId: string,
    input: CreateCustomFieldDto,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    this.assertOptions(input.type as CustomFieldType, input.options);
    try {
      const field = await this.database.client.customFieldDefinition.create({
        data: {
          description: input.description ?? null,
          key: input.key,
          name: input.name,
          ...(input.options === undefined
            ? {}
            : { options: input.options as Prisma.InputJsonValue }),
          projectId,
          type: input.type as CustomFieldType,
        },
      });
      await this.audit.record({
        action: 'custom_field.created',
        actorEmailSnapshot: context.actorEmail,
        actorUserId: context.actorUserId,
        correlationId: context.correlationId,
        entityId: field.id,
        entityType: 'CustomFieldDefinition',
        ip: context.ip,
        projectId,
        userAgent: context.userAgent,
      });
      return field;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'CUSTOM_FIELD_KEY_EXISTS',
          message: 'Custom field key already exists',
        });
      throw error;
    }
  }

  async updateCustomField(
    projectId: string,
    fieldId: string,
    input: UpdateCustomFieldDto,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    const before = await this.assertCustomField(projectId, fieldId);
    this.assertOptions(
      before.type,
      input.options ?? (before.options as string[] | null | undefined),
    );
    const field = await this.database.client.customFieldDefinition.update({
      data: {
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.options === undefined ? {} : { options: input.options as Prisma.InputJsonValue }),
      },
      where: { projectId_id: { id: fieldId, projectId } },
    });
    await this.audit.record({
      action: 'custom_field.updated',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      correlationId: context.correlationId,
      entityId: fieldId,
      entityType: 'CustomFieldDefinition',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
    return field;
  }

  async archiveCustomField(
    projectId: string,
    fieldId: string,
    context: RequestSecurityContext & { actorUserId: string; actorEmail: string },
  ) {
    await this.assertCustomField(projectId, fieldId);
    await this.database.client.customFieldDefinition.update({
      data: { archivedAt: new Date() },
      where: { projectId_id: { id: fieldId, projectId } },
    });
    await this.audit.record({
      action: 'custom_field.deleted',
      actorEmailSnapshot: context.actorEmail,
      actorUserId: context.actorUserId,
      correlationId: context.correlationId,
      entityId: fieldId,
      entityType: 'CustomFieldDefinition',
      ip: context.ip,
      projectId,
      userAgent: context.userAgent,
    });
  }

  private async assertTag(projectId: string, tagId: string) {
    const tag = await this.database.client.tag.findUnique({
      where: { projectId_id: { id: tagId, projectId } },
    });
    if (!tag || tag.archivedAt)
      throw new NotFoundException({ code: 'TAG_NOT_FOUND', message: 'Tag was not found' });
    return tag;
  }
  private async assertCustomField(projectId: string, fieldId: string) {
    const field = await this.database.client.customFieldDefinition.findUnique({
      where: { projectId_id: { id: fieldId, projectId } },
    });
    if (!field || field.archivedAt)
      throw new NotFoundException({
        code: 'CUSTOM_FIELD_NOT_FOUND',
        message: 'Custom field was not found',
      });
    return field;
  }
  private assertOptions(type: CustomFieldType, options: string[] | null | undefined) {
    const required = type === 'SELECT' || type === 'MULTI_SELECT';
    if (required && (!options || !options.length || new Set(options).size !== options.length))
      throw new ConflictException({
        code: 'CUSTOM_FIELD_OPTIONS_REQUIRED',
        message: 'Select fields require unique options',
      });
    if (!required && options?.length)
      throw new ConflictException({
        code: 'CUSTOM_FIELD_OPTIONS_NOT_ALLOWED',
        message: 'Options are only allowed for select fields',
      });
  }
  private async assertCustomFields(projectId: string, values: Record<string, unknown>) {
    const definitions = await this.database.client.customFieldDefinition.findMany({
      where: { archivedAt: null, key: { in: Object.keys(values) }, projectId },
    });
    if (definitions.length !== Object.keys(values).length)
      throw new ConflictException({
        code: 'CUSTOM_FIELD_UNKNOWN',
        message: 'Unknown custom field key',
      });
    for (const definition of definitions) {
      const value = values[definition.key];
      if (!this.isFieldValueValid(definition.type, value, definition.options))
        throw new ConflictException({
          code: 'CUSTOM_FIELD_VALUE_INVALID',
          message: `Invalid value for ${definition.key}`,
        });
    }
  }
  private isFieldValueValid(
    type: CustomFieldType,
    value: unknown,
    options: Prisma.JsonValue | null,
  ) {
    if (value === null) return true;
    if (type === 'TEXT') return typeof value === 'string';
    if (type === 'NUMBER') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'BOOLEAN') return typeof value === 'boolean';
    if (type === 'DATE') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (type === 'DATETIME') return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    if (type === 'JSON') return typeof value === 'object';
    const allowed = Array.isArray(options) ? options : [];
    return type === 'SELECT'
      ? typeof value === 'string' && allowed.includes(value)
      : Array.isArray(value) &&
          value.every((entry) => typeof entry === 'string' && allowed.includes(entry));
  }
}
