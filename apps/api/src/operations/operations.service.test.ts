import { describe, expect, it, vi } from 'vitest';

import { OperationsService } from './operations.service';

const actor = {
  email: 'operator@example.test',
  globalPermissions: [],
  globalRoleNames: ['super-admin'],
  userId: 'user-a',
};
const context = { correlationId: 'correlation-a' };

describe('OperationsService', () => {
  it('returns a safe outbox projection without provider payloads', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        attempts: 2,
        broadcastRecipient: null,
        connectionId: 'connection-a',
        createdAt: new Date('2026-08-03T00:00:00.000Z'),
        crmOperation: null,
        externalHttpOperation: null,
        id: 'outbox-a',
        kind: 'TELEGRAM',
        lastError: 'telegram_outbound_retryable',
        maxAttempts: 5,
        status: 'FAILED',
        updatedAt: new Date('2026-08-03T00:01:00.000Z'),
      },
    ]);
    const service = new OperationsService(
      {} as never,
      { client: { outboxRecord: { count: vi.fn().mockResolvedValue(1), findMany } } } as never,
      {} as never,
      {} as never,
    );

    const result = await service.list('project-a', {
      page: 1,
      pageSize: 50,
      source: 'OUTBOX',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        errorCode: 'telegram_outbound_retryable',
        id: 'outbox-a',
        retryAvailable: true,
        source: 'OUTBOX',
        status: 'FAILED',
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/payload|rawBody|token|credential/i);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ payload: true }),
        where: expect.objectContaining({ projectId: 'project-a' }),
      }),
    );
  });

  it('marks a confirmed applied UNKNOWN result succeeded without enqueueing it again', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      broadcastRecipient: { updateMany: vi.fn() },
      message: { updateMany: vi.fn() },
      outboxRecord: { updateMany },
      scheduledMessage: { updateMany: vi.fn() },
      telegramMediaGroup: { updateMany: vi.fn() },
    };
    const audit = { record: vi.fn() };
    const outbound = { enqueue: vi.fn() };
    const service = new OperationsService(
      audit as never,
      {
        client: {
          $transaction: vi.fn(async (callback) => callback(transaction)),
          outboxRecord: {
            findUnique: vi.fn().mockResolvedValue({
              externalHttpOperation: null,
              id: 'outbox-a',
              kind: 'TELEGRAM',
              status: 'UNKNOWN',
            }),
          },
        },
      } as never,
      {} as never,
      outbound as never,
    );

    await expect(
      service.reconcileOutbox(
        'project-a',
        'outbox-a',
        { outcome: 'APPLIED', reason: 'Confirmed in Telegram' },
        actor as never,
        context as never,
      ),
    ).resolves.toEqual({ id: 'outbox-a', status: 'SUCCEEDED' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
        where: expect.objectContaining({ projectId: 'project-a', status: 'UNKNOWN' }),
      }),
    );
    expect(outbound.enqueue).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'operations.outbox.reconciled',
        reason: 'Confirmed in Telegram',
      }),
    );
  });
});
