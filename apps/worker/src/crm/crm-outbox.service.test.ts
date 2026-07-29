import { CrmClientError, MockCrmClient } from '@omnicus/crm-core';
import { describe, expect, it, vi } from 'vitest';

import { CrmOutboxService } from './crm-outbox.service';

function createDatabase() {
  const operation = {
    contact: {
      channelIdentities: [
        {
          connectionId: 'connection-a',
          externalUserId: '123',
          id: 'identity-a',
        },
      ],
      customFields: {},
      customFieldValues: [],
      displayName: 'Contact A',
      email: null,
      crmLeadId: 'crm-lead-a',
      id: 'contact-a',
      phone: null,
      status: 'ACTIVE',
      tags: [],
      username: null,
    },
    contactId: 'contact-a',
    createdAt: new Date(),
    id: 'crm-operation-a',
    normalizedEvent: null,
    normalizedEventId: null,
    outbox: { attempts: 1, maxAttempts: 3 },
    project: { crmConfig: { crmProjectId: 'crm-a', enabled: true } },
    projectId: 'project-a',
    type: 'CREATE_OR_UPDATE_LEAD' as const,
  };
  const transaction = {
    contact: { update: vi.fn() },
    crmOperation: { update: vi.fn() },
    outboxRecord: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return {
    client: {
      $transaction: (callback: (input: typeof transaction) => unknown) => callback(transaction),
      crmOperation: { findUnique: vi.fn().mockResolvedValue(operation) },
      message: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      outboxRecord: {
        findMany: vi.fn().mockResolvedValue([{ id: 'outbox-a' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
    operation,
    transaction,
  };
}

const config = {
  get: vi.fn((name: string) => {
    const values: Record<string, unknown> = {
      CRM_INTEGRATION_ENABLED: true,
      CRM_OUTBOX_INTERVAL_MS: 5_000,
      CRM_OUTBOX_LEASE_MS: 60_000,
      CHANNEL_SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
      MEDIA_MAX_UPLOAD_BYTES: 20 * 1024 * 1024,
      MEDIA_RETENTION_DAYS: 30,
      MEDIA_SIGNED_URL_TTL_SECONDS: 300,
      MEDIA_STORAGE_ENABLED: false,
    };
    return values[name];
  }),
};

describe('CrmOutboxService', () => {
  it('backfills an earlier sent automation message with a stable CRM intent', async () => {
    const transaction = {
      crmOperation: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'crm-operation-history-a' }),
      },
      crmProjectConfig: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true }),
      },
      message: {
        findUnique: vi.fn().mockResolvedValue({
          contactId: 'contact-a',
          direction: 'OUTBOUND',
          externalMessageId: '42',
          metadata: { source: 'automation' },
          status: 'SENT',
        }),
      },
      outboxRecord: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          crmOperation: null,
          id: 'crm-outbox-history-a',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const database = {
      client: {
        $transaction: (callback: (input: typeof transaction) => unknown) => callback(transaction),
        message: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'message-history-a', projectId: 'project-a' }]),
        },
      },
    };
    const service = new CrmOutboxService(config as never, database as never, new MockCrmClient());

    await expect(service.recoverOutboundHistory()).resolves.toBe(1);

    expect(database.client.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        where: expect.objectContaining({
          direction: 'OUTBOUND',
          status: 'SENT',
        }),
      }),
    );
    expect(transaction.outboxRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            idempotencyKey: 'crm-outbound-history-message-history-a',
            projectId: 'project-a',
          }),
        ],
      }),
    );
  });

  it('writes a safe CRM result and completes a claimed outbox record', async () => {
    const database = createDatabase();
    const service = new CrmOutboxService(config as never, database as never, new MockCrmClient());

    await service.scanOnce(new Date());

    expect(database.transaction.crmOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          resultSafe: expect.objectContaining({
            operationId: expect.any(String),
            providerReference: expect.any(String),
          }),
        },
      }),
    );
    expect(database.transaction.outboxRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    );
  });

  it('records a safe retry state without storing provider details', async () => {
    const database = createDatabase();
    const client = new MockCrmClient(() => 'RETRYABLE_FAILURE');
    const service = new CrmOutboxService(config as never, database as never, client);

    await service.scanOnce(new Date());

    expect(database.client.outboxRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: 'crm_mock_retryable_failure',
          status: 'RETRY',
        }),
      }),
    );
  });

  it('moves an unknown outcome to explicit reconciliation state', async () => {
    const database = createDatabase();
    const client = {
      createOrUpdateLead: vi
        .fn()
        .mockRejectedValue(new CrmClientError('UNKNOWN', 'crm_transport_outcome_unknown')),
      forwardInboundMessage: vi.fn(),
      forwardOutboundMessage: vi.fn(),
      reconcile: vi.fn(),
    };
    const service = new CrmOutboxService(config as never, database as never, client);

    await service.scanOnce(new Date());

    expect(database.client.outboxRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: 'crm_transport_outcome_unknown',
          status: 'UNKNOWN',
        }),
      }),
    );
  });

  it('forwards callback context with a project-scoped source message', async () => {
    const database = createDatabase();
    const occurredAt = new Date('2026-07-29T00:00:00.000Z');
    Object.assign(database.operation, {
      normalizedEvent: {
        connectionId: 'connection-a',
        inboxRecord: { rawWebhookEvent: { correlationId: 'correlation-a' } },
        message: {
          content: {},
          conversation: { externalChatId: '123' },
          createdAt: occurredAt,
          id: 'inbound-message-a',
          mediaAsset: null,
        },
        payload: {
          content: { data: 'budget:1000', id: 'callback-a' },
          metadata: { telegramCallbackQuery: { message: { message_id: 42 } } },
        },
      },
      normalizedEventId: 'normalized-event-a',
      type: 'FORWARD_INBOUND_MESSAGE',
    });
    database.client.message.findFirst.mockResolvedValue({
      content: {
        inlineKeyboard: [[{ callbackData: 'budget:1000', text: 'Under 1000' }]],
      },
      id: 'source-message-a',
      metadata: null,
    });
    const client = {
      createOrUpdateLead: vi.fn(),
      forwardInboundMessage: vi.fn().mockResolvedValue({
        mode: 'created',
        operationId: 'operation-provider-a',
        providerReference: 'crm-message-a',
      }),
      forwardOutboundMessage: vi.fn(),
      reconcile: vi.fn(),
    };
    const service = new CrmOutboxService(config as never, database as never, client);

    await service.scanOnce(new Date());

    expect(database.client.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connectionId: 'connection-a',
          externalMessageId: '42',
          projectId: 'project-a',
        }),
      }),
    );
    expect(client.forwardInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        interactive: {
          callbackQueryId: 'callback-a',
          data: 'budget:1000',
          displayText: 'Under 1000',
          sourceMessageId: 'source-message-a',
          type: 'callback_query',
        },
        text: 'Under 1000',
      }),
    );
  });

  it('forwards a confirmed automation message with buttons to CRM history', async () => {
    const database = createDatabase();
    Object.assign(database.operation, {
      message: {
        connection: { botUsername: 'omnicus_test_bot' },
        connectionId: 'connection-a',
        content: {
          inlineKeyboard: [[{ callbackData: 'budget:1000', text: 'Under 1000' }]],
          text: 'What is your budget?',
        },
        conversation: { externalChatId: '123' },
        createdAt: new Date('2026-07-29T00:00:00.000Z'),
        externalMessageId: '42',
        id: 'outbound-message-a',
        mediaAsset: null,
        metadata: {
          scenarioExecutionId: 'execution-a',
          source: 'automation',
        },
        sentAt: new Date('2026-07-29T00:00:01.000Z'),
      },
      type: 'FORWARD_OUTBOUND_MESSAGE',
    });
    const client = {
      createOrUpdateLead: vi.fn(),
      forwardInboundMessage: vi.fn(),
      forwardOutboundMessage: vi.fn().mockResolvedValue({
        mode: 'created',
        operationId: 'operation-provider-a',
        providerReference: 'crm-message-a',
      }),
      reconcile: vi.fn(),
    };
    const service = new CrmOutboxService(config as never, database as never, client);

    await service.scanOnce(new Date());

    expect(client.forwardOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        crmProjectId: 'crm-a',
        projectId: 'project-a',
      }),
      expect.objectContaining({
        contactId: 'contact-a',
        deliveryStatus: 'SENT',
        inlineKeyboard: [[{ callbackData: 'budget:1000', text: 'Under 1000' }]],
        messageId: 'outbound-message-a',
        providerMessageId: '42',
        scenarioExecutionId: 'execution-a',
        senderName: '@omnicus_test_bot',
        source: 'AUTOMATION',
        text: 'What is your budget?',
      }),
    );
  });
});
