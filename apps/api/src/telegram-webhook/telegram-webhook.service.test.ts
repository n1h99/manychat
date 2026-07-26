import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@omnicus/database';
import { describe, expect, it, vi } from 'vitest';

import { TelegramWebhookService } from './telegram-webhook.service';

const testConnection = {
  id: 'connection-a',
  projectId: 'project-a',
  webhookSecretEncrypted: {} as never,
};
const context = { correlationId: 'correlation-a', ip: '203.0.113.10', userAgent: 'telegram' };

function createHarness(options?: { enqueueFails?: boolean; duplicate?: boolean }) {
  const rawCreate = options?.duplicate
    ? vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          clientVersion: '7.9.0',
          code: 'P2002',
          meta: { target: ['connectionId', 'externalUpdateId'] },
        }),
      )
    : vi.fn().mockResolvedValue({ id: 'raw-a' });
  const inboxCreate = vi.fn().mockResolvedValue({ id: 'inbox-a' });
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ inboxRecord: { create: inboxCreate }, rawWebhookEvent: { create: rawCreate } }),
  );
  const inboxUpdate = vi.fn().mockResolvedValue(undefined);
  const connections = {
    findActiveTelegramConnection: vi.fn().mockResolvedValue(testConnection),
    markWebhookReceived: vi.fn().mockResolvedValue(undefined),
    verifyWebhookSecret: vi.fn().mockResolvedValue(true),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const queue = {
    enqueue: options?.enqueueFails
      ? vi.fn().mockRejectedValue(new Error('redis unavailable'))
      : vi.fn().mockResolvedValue(undefined),
  };
  const service = new TelegramWebhookService(
    audit as never,
    connections as never,
    { client: { $transaction: transaction, inboxRecord: { update: inboxUpdate } } } as never,
    queue as never,
  );

  return { audit, connections, inboxCreate, inboxUpdate, queue, rawCreate, service, transaction };
}

describe('TelegramWebhookService', () => {
  it('persists one valid update transactionally and enqueues only the inbox ID', async () => {
    const { inboxCreate, queue, rawCreate, service } = createHarness();

    await expect(
      service.receive('connection-a', 'valid-secret', { update_id: 1 }, context),
    ).resolves.toEqual({
      accepted: true,
      duplicate: false,
    });

    expect(rawCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          connectionId: 'connection-a',
          correlationId: 'correlation-a',
          externalUpdateId: '1',
          projectId: 'project-a',
        }),
      }),
    );
    expect(inboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: 0,
          maxAttempts: 8,
          nextAttemptAt: expect.any(Date),
          status: 'PENDING',
        }),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('inbox-a');
    expect(queue.enqueue.mock.calls[0]).toEqual([expect.stringMatching(/^inbox-/)]);
  });

  it('acknowledges a duplicate update without a second inbox record or queue job', async () => {
    const { inboxCreate, queue, service } = createHarness({ duplicate: true });

    await expect(
      service.receive('connection-a', 'valid-secret', { update_id: 1 }, context),
    ).resolves.toEqual({
      accepted: true,
      duplicate: true,
    });

    expect(inboxCreate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('keeps committed PostgreSQL intent when Redis enqueue fails', async () => {
    const { inboxUpdate, rawCreate, service } = createHarness({ enqueueFails: true });

    await expect(
      service.receive('connection-a', 'valid-secret', { update_id: 2 }, context),
    ).resolves.toEqual({
      accepted: true,
      duplicate: false,
    });
    expect(rawCreate).toHaveBeenCalledTimes(1);
    expect(inboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastError: 'telegram_inbound_enqueue_failed' } }),
    );
  });

  it('does not persist a body or enqueue a job when the secret is rejected', async () => {
    const { audit, connections, rawCreate, service, transaction } = createHarness();
    connections.verifyWebhookSecret.mockResolvedValue(false);
    const warning = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      await expect(
        service.receive(
          'connection-a',
          'wrong-secret',
          { update_id: 3, text: 'must not persist' },
          context,
        ),
      ).resolves.toEqual({ accepted: false, duplicate: false });

      expect(transaction).not.toHaveBeenCalled();
      expect(rawCreate).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'security.webhook_secret_rejected',
          correlationId: 'correlation-a',
          projectId: 'project-a',
        }),
      );
      const safeOutput = JSON.stringify({
        audit: audit.record.mock.calls,
        logs: warning.mock.calls,
      });
      expect(safeOutput).not.toContain('wrong-secret');
      expect(safeOutput).not.toContain('must not persist');
    } finally {
      warning.mockRestore();
    }
  });

  it('does not persist a body when the secret header is absent', async () => {
    const { connections, rawCreate, service, transaction } = createHarness();
    connections.verifyWebhookSecret.mockResolvedValue(false);

    await expect(
      service.receive('connection-a', undefined, { update_id: 3 }, context),
    ).resolves.toEqual({ accepted: false, duplicate: false });

    expect(transaction).not.toHaveBeenCalled();
    expect(rawCreate).not.toHaveBeenCalled();
  });

  it('rejects a malformed update before persisting anything', async () => {
    const { service, transaction } = createHarness();

    await expect(
      service.receive('connection-a', 'valid-secret', { message: {} }, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not allow a request body project ID to choose the persisted tenant', async () => {
    const { rawCreate, service } = createHarness();

    await service.receive(
      'connection-a',
      'valid-secret',
      { projectId: 'attacker-project', update_id: 4 },
      context,
    );

    expect(rawCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 'project-a' }) }),
    );
  });

  it('treats the same update ID from different connections as separate provider scopes', async () => {
    const { connections, rawCreate, service } = createHarness();
    connections.findActiveTelegramConnection
      .mockResolvedValueOnce(testConnection)
      .mockResolvedValueOnce({ ...testConnection, id: 'connection-b', projectId: 'project-b' });

    await service.receive('connection-a', 'valid-secret', { update_id: 5 }, context);
    await service.receive('connection-b', 'valid-secret', { update_id: 5 }, context);

    expect(rawCreate.mock.calls.map(([argument]) => argument.data.connectionId)).toEqual([
      'connection-a',
      'connection-b',
    ]);
  });

  it('propagates an unknown connection without attempting persistence', async () => {
    const { connections, service, transaction } = createHarness();
    connections.findActiveTelegramConnection.mockRejectedValue(
      new NotFoundException({ code: 'WEBHOOK_CONNECTION_NOT_FOUND' }),
    );

    await expect(
      service.receive('missing', 'secret', { update_id: 6 }, context),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
