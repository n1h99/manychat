import type { Prisma } from '@omnicus/database';

export type CrmOutboundHistorySource = 'AUTOMATION' | 'BROADCAST' | 'SYSTEM';

function record(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function crmOutboundHistorySource(
  metadata: Prisma.JsonValue | null | undefined,
): CrmOutboundHistorySource | undefined {
  const value = record(metadata);
  if (value?.source === 'crm') return undefined;
  if (value?.source === 'automation') return 'AUTOMATION';
  if (value?.source === 'broadcast' || typeof value?.broadcastId === 'string') return 'BROADCAST';
  return 'SYSTEM';
}

export async function ensureCrmOutboundHistoryIntent(
  transaction: Prisma.TransactionClient,
  projectId: string,
  messageId: string,
): Promise<boolean> {
  const [message, crmConfig] = await Promise.all([
    transaction.message.findUnique({
      select: {
        contactId: true,
        direction: true,
        externalMessageId: true,
        metadata: true,
        status: true,
      },
      where: { projectId_id: { id: messageId, projectId } },
    }),
    transaction.crmProjectConfig.findUnique({
      select: { enabled: true },
      where: { projectId },
    }),
  ]);
  const source = crmOutboundHistorySource(message?.metadata);
  if (
    !message ||
    !crmConfig?.enabled ||
    message.direction !== 'OUTBOUND' ||
    message.status !== 'SENT' ||
    !message.externalMessageId ||
    !source
  )
    return false;

  const idempotencyKey = `crm-outbound-history-${messageId}`;
  await transaction.outboxRecord.createMany({
    data: [{ idempotencyKey, kind: 'CRM', payload: {}, projectId }],
    skipDuplicates: true,
  });
  const outbox = await transaction.outboxRecord.findUnique({
    include: { crmOperation: { select: { id: true } } },
    where: { projectId_idempotencyKey: { idempotencyKey, projectId } },
  });
  if (!outbox) return false;
  if (!outbox.crmOperation) {
    const metadata = record(message.metadata);
    await transaction.crmOperation.createMany({
      data: [
        {
          contactId: message.contactId,
          inputSafe: {
            source,
            ...(typeof metadata?.broadcastId === 'string'
              ? { broadcastId: metadata.broadcastId }
              : {}),
            ...(typeof metadata?.scenarioExecutionId === 'string'
              ? { scenarioExecutionId: metadata.scenarioExecutionId }
              : {}),
          },
          messageId,
          outboxRecordId: outbox.id,
          projectId,
          type: 'FORWARD_OUTBOUND_MESSAGE',
        },
      ],
      skipDuplicates: true,
    });
  }
  const operation = await transaction.crmOperation.findUnique({
    select: { id: true },
    where: { outboxRecordId: outbox.id },
  });
  if (!operation) return false;
  await transaction.outboxRecord.update({
    data: { payload: { crmOperationId: operation.id } },
    where: { projectId_id: { id: outbox.id, projectId } },
  });
  return true;
}
