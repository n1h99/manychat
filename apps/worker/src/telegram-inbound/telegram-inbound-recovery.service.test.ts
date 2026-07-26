import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import {
  TelegramInboundRecoveryService,
  type TelegramInboundRecoveryQueue,
} from './telegram-inbound-recovery.service';

const TEST_CHANNEL_SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');
const now = new Date('2026-07-26T12:00:00.000Z');

function createHarness(records: Array<Record<string, unknown>> = []) {
  const add = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findMany = vi.fn().mockResolvedValue(records);
  const findUnique = vi.fn();
  const projectFindUniqueOrThrow = vi.fn().mockResolvedValue({ name: 'Project', slug: 'project' });
  const auditCreate = vi.fn().mockResolvedValue({});
  const queue: TelegramInboundRecoveryQueue = {
    add,
    close: vi.fn().mockResolvedValue(undefined),
  };
  const database = {
    client: {
      auditLog: { create: auditCreate },
      inboxRecord: { findMany, findUnique, updateMany },
      project: { findUniqueOrThrow: projectFindUniqueOrThrow },
    },
  };
  const config = new ConfigService({
    APP_ENV: 'test',
    CHANNEL_SECRETS_KEY: TEST_CHANNEL_SECRETS_KEY,
    DATABASE_URL: 'postgresql://omnicus:omnicus@localhost:5432/omnicus',
    DEMO_JOB_ENABLED: false,
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379/0',
    TELEGRAM_INBOUND_LEASE_MS: 60_000,
    TELEGRAM_INBOUND_RECOVERY_BATCH_SIZE: 10,
    TELEGRAM_INBOUND_RECOVERY_INTERVAL_MS: 10_000,
  });
  return {
    add,
    auditCreate,
    database,
    findMany,
    findUnique,
    service: new TelegramInboundRecoveryService(config as never, database as never, queue),
    updateMany,
  };
}

describe('TelegramInboundRecoveryService', () => {
  it('re-enqueues lost pending and due retry records using a stable inbox-only job', async () => {
    const { add, service } = createHarness([
      { id: 'pending-a', lockedAt: null, projectId: 'project-a', status: 'PENDING' },
      { id: 'retry-a', lockedAt: null, projectId: 'project-a', status: 'RETRY' },
    ]);

    await service.scanOnce(now);

    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenNthCalledWith(
      1,
      'process-inbox-record',
      { inboxRecordId: 'pending-a' },
      expect.objectContaining({
        jobId: 'telegram-inbound:pending-a',
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      'process-inbox-record',
      { inboxRecordId: 'retry-a' },
      expect.objectContaining({ jobId: 'telegram-inbound:retry-a' }),
    );
  });

  it('does not select future retry or terminal records', async () => {
    const { findMany, service } = createHarness();

    await service.scanOnce(now);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            { nextAttemptAt: { lte: now }, status: 'PENDING' },
            { nextAttemptAt: { lte: now }, status: 'RETRY' },
          ]),
        },
      }),
    );
  });

  it('releases expired leases, but leaves active leases for their owner', async () => {
    const { add, service, updateMany } = createHarness([
      {
        id: 'expired-a',
        lockedAt: new Date(now.getTime() - 61_000),
        projectId: 'project-a',
        status: 'PROCESSING',
      },
    ]);

    await service.scanOnce(now);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RETRY' }),
        where: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
    expect(add).toHaveBeenCalledOnce();
  });

  it('keeps a record available when recovery enqueue fails', async () => {
    const { add, service } = createHarness([
      { id: 'pending-a', lockedAt: null, projectId: 'project-a', status: 'PENDING' },
    ]);
    add.mockRejectedValueOnce(new Error('Redis refused connection'));

    await expect(service.scanOnce(now)).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledOnce();
  });

  it('relies on the same stable job ID across recovery scans', async () => {
    const { add, service } = createHarness([
      { id: 'pending-a', lockedAt: null, projectId: 'project-a', status: 'PENDING' },
    ]);

    await service.scanOnce(now);
    await service.scanOnce(new Date(now.getTime() + 1_000));

    expect(add.mock.calls.map((call) => call[2].jobId)).toEqual([
      'telegram-inbound:pending-a',
      'telegram-inbound:pending-a',
    ]);
  });

  it('manually retries only terminal records and audits the safe action', async () => {
    const { add, auditCreate, findUnique, service, updateMany } = createHarness();
    findUnique.mockResolvedValue({ id: 'dead-a', projectId: 'project-a', status: 'DEAD_LETTER' });

    await expect(
      service.retryDeadLetter({ inboxRecordId: 'dead-a', resetAttempts: true }),
    ).resolves.toEqual({
      enqueued: true,
      inboxRecordId: 'dead-a',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attempts: 0, status: 'RETRY' }) }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'inbox.manual_retry_requested',
          afterSafeJson: { resetAttempts: true },
        }),
      }),
    );
    expect(add).toHaveBeenCalledWith(
      'process-inbox-record',
      { inboxRecordId: 'dead-a' },
      expect.objectContaining({ jobId: 'telegram-inbound:dead-a' }),
    );
  });
});
