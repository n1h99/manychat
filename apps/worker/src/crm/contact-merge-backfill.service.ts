import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@omnicus/database';

import { DatabaseService } from '../database/database.service';

interface BackfillOptions {
  batchSize: number;
  dryRun: boolean;
  projectId?: string;
}

interface MergeNode {
  id: string;
  mergedIntoContactId: string | null;
  projectId: string;
  status: string;
}

interface MergePair {
  primaryContactId: string;
  projectId: string;
  secondaryContactId: string;
}

export interface ContactMergeBackfillReport {
  alreadyQueued: number;
  conflicts: Array<{ projectId: string; reason: string; secondaryContactId: string }>;
  crmDisabled: number;
  dryRun: boolean;
  failed: Array<{ projectId: string; reason: string; secondaryContactId: string }>;
  queued: number;
  repairable: number;
  repaired: number;
  requeued: number;
  scanned: number;
}

@Injectable()
export class ContactMergeBackfillService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async run(options: BackfillOptions): Promise<ContactMergeBackfillReport> {
    const mergedContacts = await this.database.client.contact.findMany({
      orderBy: [{ projectId: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        mergedIntoContactId: true,
        projectId: true,
        status: true,
      },
      where: {
        mergedIntoContactId: { not: null },
        ...(options.projectId ? { projectId: options.projectId } : {}),
        status: 'MERGED',
      },
    });
    const nodes = new Map<string, MergeNode>(
      mergedContacts.map((contact) => [this.key(contact.projectId, contact.id), contact]),
    );
    const report: ContactMergeBackfillReport = {
      alreadyQueued: 0,
      conflicts: [],
      crmDisabled: 0,
      dryRun: options.dryRun,
      failed: [],
      queued: 0,
      repairable: 0,
      repaired: 0,
      requeued: 0,
      scanned: mergedContacts.length,
    };
    const pairs: MergePair[] = [];

    for (const secondary of mergedContacts) {
      try {
        const primary = await this.resolvePrimary(secondary, nodes);
        pairs.push({
          primaryContactId: primary.id,
          projectId: secondary.projectId,
          secondaryContactId: secondary.id,
        });
      } catch (error) {
        report.conflicts.push({
          projectId: secondary.projectId,
          reason: this.safeError(error),
          secondaryContactId: secondary.id,
        });
      }
    }
    report.repairable = pairs.length;
    if (options.dryRun) return report;

    for (let offset = 0; offset < pairs.length; offset += options.batchSize) {
      const batch = pairs.slice(offset, offset + options.batchSize);
      for (const pair of batch) {
        try {
          const outcome = await this.repair(pair);
          report.repaired += 1;
          if (outcome === 'queued') report.queued += 1;
          else if (outcome === 'requeued') report.requeued += 1;
          else if (outcome === 'already-queued') report.alreadyQueued += 1;
          else report.crmDisabled += 1;
        } catch (error) {
          report.failed.push({
            projectId: pair.projectId,
            reason: this.safeError(error),
            secondaryContactId: pair.secondaryContactId,
          });
        }
      }
    }
    return report;
  }

  private async resolvePrimary(
    secondary: MergeNode,
    nodes: Map<string, MergeNode>,
  ): Promise<MergeNode> {
    const visited = new Set([secondary.id]);
    let current = secondary;
    while (current.mergedIntoContactId) {
      const targetId = current.mergedIntoContactId;
      if (visited.has(targetId)) throw new Error('CONTACT_MERGE_CYCLE');
      visited.add(targetId);
      const targetKey = this.key(secondary.projectId, targetId);
      let target = nodes.get(targetKey);
      if (!target) {
        const stored = await this.database.client.contact.findUnique({
          select: {
            id: true,
            mergedIntoContactId: true,
            projectId: true,
            status: true,
          },
          where: { projectId_id: { id: targetId, projectId: secondary.projectId } },
        });
        if (!stored) throw new Error('CONTACT_MERGE_TARGET_NOT_FOUND');
        target = stored;
        nodes.set(targetKey, target);
      }
      if (target.projectId !== secondary.projectId)
        throw new Error('CONTACT_MERGE_PROJECT_MISMATCH');
      current = target;
    }
    if (current.status === 'MERGED') throw new Error('CONTACT_MERGE_TARGET_INVALID');
    return current;
  }

  private async repair(pair: MergePair) {
    return this.database.client.$transaction(async (transaction) => {
      const contacts = await transaction.contact.findMany({
        include: { channelIdentities: true, tags: true },
        where: {
          id: { in: [pair.primaryContactId, pair.secondaryContactId] },
          projectId: pair.projectId,
        },
      });
      const primary = contacts.find((contact) => contact.id === pair.primaryContactId);
      const secondary = contacts.find((contact) => contact.id === pair.secondaryContactId);
      if (!primary || !secondary) throw new Error('CONTACT_MERGE_PAIR_NOT_FOUND');
      if (secondary.status !== 'MERGED') throw new Error('CONTACT_MERGE_SOURCE_NOT_MERGED');
      if (primary.status === 'MERGED') throw new Error('CONTACT_MERGE_TARGET_STILL_MERGED');

      const primaryIdentityByKey = new Map(
        primary.channelIdentities.map((identity) => [
          `${identity.connectionId}:${identity.externalUserId}`,
          identity,
        ]),
      );
      const duplicates = secondary.channelIdentities.flatMap((identity) => {
        const survivor = primaryIdentityByKey.get(
          `${identity.connectionId}:${identity.externalUserId}`,
        );
        return survivor ? [{ duplicate: identity, survivor }] : [];
      });
      for (const { duplicate, survivor } of duplicates)
        await Promise.all([
          transaction.broadcastRecipient.updateMany({
            data: { channelIdentityId: survivor.id, contactId: primary.id },
            where: { channelIdentityId: duplicate.id, projectId: pair.projectId },
          }),
          transaction.scheduledMessage.updateMany({
            data: { channelIdentityId: survivor.id, contactId: primary.id },
            where: { channelIdentityId: duplicate.id, projectId: pair.projectId },
          }),
          transaction.telegramMediaGroup.updateMany({
            data: { channelIdentityId: survivor.id, contactId: primary.id },
            where: { channelIdentityId: duplicate.id, projectId: pair.projectId },
          }),
        ]);
      const duplicateIds = duplicates.map(({ duplicate }) => duplicate.id);
      if (duplicateIds.length)
        await transaction.channelIdentity.deleteMany({
          where: { id: { in: duplicateIds }, projectId: pair.projectId },
        });
      await transaction.channelIdentity.updateMany({
        data: { contactId: primary.id },
        where: { contactId: secondary.id, projectId: pair.projectId },
      });

      await transaction.contactTag.createMany({
        data: secondary.tags.map((tag) => ({
          contactId: primary.id,
          projectId: pair.projectId,
          source: 'MERGE',
          tagId: tag.tagId,
        })),
        skipDuplicates: true,
      });
      await transaction.contactTag.deleteMany({
        where: { contactId: secondary.id, projectId: pair.projectId },
      });
      await Promise.all([
        transaction.conversation.updateMany({
          data: { contactId: primary.id },
          where: { contactId: secondary.id, projectId: pair.projectId },
        }),
        transaction.message.updateMany({
          data: { contactId: primary.id },
          where: { contactId: secondary.id, projectId: pair.projectId },
        }),
        transaction.scenarioExecution.updateMany({
          data: { contactId: primary.id },
          where: { contactId: secondary.id, projectId: pair.projectId },
        }),
        transaction.crmOperation.updateMany({
          data: { contactId: primary.id },
          where: { contactId: secondary.id, projectId: pair.projectId },
        }),
        transaction.broadcastRecipient.updateMany({
          data: { contactId: primary.id },
          where: { contactId: secondary.id, projectId: pair.projectId },
        }),
        transaction.scheduledMessage.updateMany({
          data: { contactId: primary.id },
          where: { contactId: secondary.id, projectId: pair.projectId },
        }),
        transaction.telegramMediaGroup.updateMany({
          data: { contactId: primary.id },
          where: { contactId: secondary.id, projectId: pair.projectId },
        }),
      ]);

      const customFields = {
        ...this.jsonObject(secondary.customFields),
        ...this.jsonObject(primary.customFields),
      };
      await transaction.contact.update({
        data: {
          crmContactId: primary.crmContactId ?? secondary.crmContactId,
          crmLeadId: primary.crmLeadId ?? secondary.crmLeadId,
          crmManagerId: primary.crmManagerId ?? secondary.crmManagerId,
          customFields: customFields as Prisma.InputJsonValue,
          displayName: primary.displayName ?? secondary.displayName,
          email: primary.email ?? secondary.email,
          firstInteractionAt: this.earliest(
            primary.firstInteractionAt,
            secondary.firstInteractionAt,
          ),
          firstName: primary.firstName ?? secondary.firstName,
          lastInteractionAt: this.latest(
            primary.lastInteractionAt,
            secondary.lastInteractionAt,
          ),
          lastName: primary.lastName ?? secondary.lastName,
          phone: primary.phone ?? secondary.phone,
          username: primary.username ?? secondary.username,
        },
        where: { projectId_id: { id: primary.id, projectId: pair.projectId } },
      });
      await transaction.contact.update({
        data: { mergedIntoContactId: primary.id },
        where: { projectId_id: { id: secondary.id, projectId: pair.projectId } },
      });

      const crmConfig = await transaction.crmProjectConfig.findUnique({
        select: { enabled: true },
        where: { projectId: pair.projectId },
      });
      if (!crmConfig?.enabled) return 'crm-disabled' as const;
      return this.ensureCrmOperation(transaction, pair, primary, secondary);
    });
  }

  private async ensureCrmOperation(
    transaction: Prisma.TransactionClient,
    pair: MergePair,
    primary: { crmLeadId: string | null },
    secondary: { crmLeadId: string | null },
  ) {
    const idempotencyKey = `crm-contact-merge-backfill-${pair.primaryContactId}-${pair.secondaryContactId}`;
    const existing = await transaction.outboxRecord.findFirst({
      where: { idempotencyKey, projectId: pair.projectId },
    });
    if (existing) {
      const operation = await transaction.crmOperation.findUnique({
        where: { outboxRecordId: existing.id },
      });
      if (!operation)
        await transaction.crmOperation.create({
          data: this.crmOperationData(pair, primary, secondary, existing.id),
        });
      if (existing.status === 'FAILED' || existing.status === 'UNKNOWN') {
        await transaction.outboxRecord.update({
          data: {
            attempts: 0,
            completedAt: null,
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            nextAttemptAt: new Date(),
            status: 'RETRY',
          },
          where: { id: existing.id },
        });
        return 'requeued' as const;
      }
      return 'already-queued' as const;
    }
    const outbox = await transaction.outboxRecord.create({
      data: {
        idempotencyKey,
        kind: 'CRM',
        nextAttemptAt: new Date(),
        payload: {
          operationType: 'MERGE_CONTACTS',
          primaryContactId: pair.primaryContactId,
          secondaryContactId: pair.secondaryContactId,
        },
        projectId: pair.projectId,
      },
    });
    await transaction.crmOperation.create({
      data: this.crmOperationData(pair, primary, secondary, outbox.id),
    });
    return 'queued' as const;
  }

  private crmOperationData(
    pair: MergePair,
    primary: { crmLeadId: string | null },
    secondary: { crmLeadId: string | null },
    outboxRecordId: string,
  ) {
    return {
      contactId: pair.primaryContactId,
      inputSafe: {
        correlationId: `contact-merge-backfill-${pair.secondaryContactId}`,
        primaryContactId: pair.primaryContactId,
        ...(primary.crmLeadId ? { primaryCrmLeadId: primary.crmLeadId } : {}),
        secondaryContactId: pair.secondaryContactId,
        ...(secondary.crmLeadId ? { secondaryCrmLeadId: secondary.crmLeadId } : {}),
      },
      outboxRecordId,
      projectId: pair.projectId,
      type: 'MERGE_CONTACTS' as const,
    };
  }

  private earliest(left: Date | null, right: Date | null) {
    if (!left) return right;
    if (!right) return left;
    return left.getTime() <= right.getTime() ? left : right;
  }

  private latest(left: Date | null, right: Date | null) {
    if (!left) return right;
    if (!right) return left;
    return left.getTime() >= right.getTime() ? left : right;
  }

  private jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private key(projectId: string, contactId: string) {
    return `${projectId}:${contactId}`;
  }

  private safeError(error: unknown) {
    return error instanceof Error ? error.message : 'CONTACT_MERGE_BACKFILL_UNKNOWN_ERROR';
  }
}
