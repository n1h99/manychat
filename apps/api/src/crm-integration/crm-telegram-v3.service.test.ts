import { ConfigService } from '@nestjs/config';
import { ChannelSecretsService } from '@omnicus/channel-secrets';
import { TelegramAdapter } from '@omnicus/channel-telegram';
import { describe, expect, it, vi } from 'vitest';

import { CrmTelegramV3Service } from './crm-telegram-v3.service';

const key = Buffer.alloc(32, 7).toString('base64');
const scope = {
  crmProjectId: 'crm-project-a',
  identity: {
    channel: 'telegram' as const,
    channelIdentityId: 'identity-a',
    connectionId: 'connection-a',
  },
  omnicusContactId: 'contact-a',
  omnicusProjectId: 'project-a',
};

function fixture() {
  const credentialsEncrypted = new ChannelSecretsService(key).encryptSecret({
    channelConnectionId: 'connection-a',
    channelType: 'telegram',
    field: 'botToken',
    plaintext: 'telegram-test-token',
    projectId: 'project-a',
  });
  const outbox = {
    id: 'operation-a',
    kind: 'TELEGRAM',
    payload: { messageId: 'message-a' },
    status: 'PENDING',
  };
  const transaction = {
    conversation: {
      create: vi.fn().mockResolvedValue({
        automationReasonCode: 'CRM_PAUSE',
        automationResumeAt: new Date('2026-08-03T00:00:00.000Z'),
        automationRevision: 1,
        automationState: 'PAUSED',
        connectionId: 'connection-a',
        contactId: 'contact-a',
        id: 'conversation-a',
        projectId: 'project-a',
        updatedAt: new Date('2026-08-02T05:00:00.000Z'),
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
    },
    crmProjectConfig: {
      findUnique: vi.fn().mockResolvedValue({ enabled: false, status: 'ACTIVE' }),
    },
    idempotencyRecord: { create: vi.fn() },
  };
  const database = {
    client: {
      $transaction: (callback: (input: typeof transaction) => unknown) => callback(transaction),
      channelConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'connection-a',
          status: 'ACTIVE',
          type: 'TELEGRAM',
        }),
      },
      channelIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          channel: 'TELEGRAM',
          connection: {
            credentialsEncrypted,
            id: 'connection-a',
            projectId: 'project-a',
            status: 'ACTIVE',
            type: 'TELEGRAM',
          },
          connectionId: 'connection-a',
          contactId: 'contact-a',
          externalUserId: '123',
          status: 'ACTIVE',
        }),
      },
      message: {
        findFirst: vi.fn().mockResolvedValue({
          direction: 'OUTBOUND',
          externalMessageId: '42',
          id: 'message-a',
          projectId: 'project-a',
        }),
      },
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      outboxRecord: {
        create: vi.fn().mockResolvedValue(outbox),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          crmConfig: { crmProjectId: 'crm-project-a', enabled: true },
          status: 'ACTIVE',
        }),
      },
    },
  };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const service = new CrmTelegramV3Service(
    database as never,
    queue as never,
    new ConfigService({ CHANNEL_SECRETS_KEY: key }) as never,
  );
  return { database, queue, service, transaction };
}

describe('CrmTelegramV3Service', () => {
  it('returns a connection-scoped machine-readable capability matrix', async () => {
    const test = fixture();
    await expect(
      test.service.capabilities({
        connectionId: 'connection-a',
        crmProjectId: 'crm-project-a',
        omnicusProjectId: 'project-a',
      }),
    ).resolves.toMatchObject({
      capabilities: {
        editMessage: {
          limits: expect.objectContaining({
            editableFields: ['text', 'caption', 'entities', 'inlineKeyboard', 'linkPreviewOptions'],
            immutableFields: expect.arrayContaining(['protectContent', 'messageEffectId']),
          }),
          supported: true,
        },
        explicitRetry: { supported: true },
        linkPreviewOptions: { supported: true },
        mediaSpoilers: {
          limits: { mediaKinds: ['ANIMATION', 'PHOTO', 'VIDEO'] },
          supported: true,
        },
        messageEffects: {
          limits: expect.objectContaining({
            availableEffects: [],
            catalogAvailable: false,
            catalogReasonCode: 'BOT_API_EFFECT_CATALOG_UNAVAILABLE',
            editable: false,
          }),
          supported: true,
        },
        quote: { supported: true },
        reactions: { supported: true },
        automationPausedMode: { supported: true },
        botInterface: { supported: true },
        contactShare: { supported: true },
        mediaGroups: { supported: true },
        scheduling: {
          limits: expect.objectContaining({
            applicationOwned: true,
            frequencies: ['DAILY', 'WEEKLY'],
            recurring: true,
          }),
          supported: true,
        },
        replyKeyboard: { supported: true },
        richMessages: {
          limits: expect.objectContaining({ externalMediaUrls: false, maximumMediaAssets: 1 }),
          supported: true,
        },
        stickers: {
          limits: expect.objectContaining({
            captions: false,
            formats: ['TGS', 'WEBM', 'WEBP'],
          }),
          supported: true,
        },
        streamingDraft: {
          limits: expect.objectContaining({ mediaDirectUpload: false, mediaReuseOnly: true }),
          supported: true,
        },
        userReactionEvents: {
          limits: expect.objectContaining({ contractPublished: true, privateChatsOnly: true }),
          supported: true,
        },
      },
      contractVersion: '3.3.0',
      telegramBotApiVersion: '10.2',
    });
  });

  it('ignores an empty draft without calling Telegram or creating a placeholder message', async () => {
    const test = fixture();
    const sendMessageDraft = vi
      .spyOn(TelegramAdapter.prototype, 'sendMessageDraft')
      .mockResolvedValue(undefined);

    await expect(test.service.draft({ ...scope, draftId: 7, text: '' })).resolves.toEqual({
      accepted: false,
      expiresAt: null,
      reasonCode: 'EMPTY_DRAFT_IGNORED',
    });

    expect(sendMessageDraft).not.toHaveBeenCalled();
    expect(test.database.client.channelIdentity.findUnique).not.toHaveBeenCalled();
  });

  it('durably queues a scoped edit with a stable operation', async () => {
    const test = fixture();
    await expect(
      test.service.edit(
        'message-a',
        { ...scope, text: 'Edited text' },
        'edit-request-a',
        'correlation-a',
      ),
    ).resolves.toEqual({
      messageId: 'message-a',
      operationId: 'operation-a',
      replayed: false,
      status: 'QUEUED',
    });
    expect(test.database.client.outboxRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'crm-v3-edit-request-a',
          payload: expect.objectContaining({ action: 'EDIT_MESSAGE' }),
        }),
      }),
    );
    expect(test.queue.enqueue).toHaveBeenCalledWith('operation-a');
  });

  it('stores a replayable PAUSED transition with optimistic concurrency metadata', async () => {
    const test = fixture();

    await expect(
      test.service.setAutomationState(
        {
          ...scope,
          expectedRevision: 0,
          mode: 'PAUSED',
          reasonCode: 'CRM_PAUSE',
          resumeAt: '2099-08-03T00:00:00.000Z',
        },
        'automation-state-a',
        'correlation-a',
      ),
    ).resolves.toMatchObject({ mode: 'PAUSED', revision: 1 });

    expect(test.transaction.idempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'automation-state-a',
        projectId: 'project-a',
        resultSafe: expect.objectContaining({
          request: expect.objectContaining({ expectedRevision: 0, mode: 'PAUSED' }),
          response: expect.objectContaining({ mode: 'PAUSED', revision: 1 }),
        }),
        scope: 'crm-automation-state',
      }),
    });
  });

  it('never retries an UNKNOWN operation blindly', async () => {
    const test = fixture();
    test.database.client.outboxRecord.findUnique.mockResolvedValue({
      id: 'operation-a',
      kind: 'TELEGRAM',
      status: 'UNKNOWN',
    });
    await expect(
      test.service.retry(
        'operation-a',
        {
          crmProjectId: 'crm-project-a',
          omnicusProjectId: 'project-a',
          retryRequestId: 'retry-a',
        },
        'correlation-a',
      ),
    ).rejects.toMatchObject({ response: { code: 'UNKNOWN_REQUIRES_RECONCILIATION' } });
    expect(test.queue.enqueue).not.toHaveBeenCalled();
  });

  it('creates a retry operation with the original message identifier', async () => {
    const test = fixture();
    test.database.client.outboxRecord.findUnique
      .mockResolvedValueOnce({
        connectionId: 'connection-a',
        id: 'failed-operation-a',
        kind: 'TELEGRAM',
        maxAttempts: 5,
        payload: { action: 'EDIT_MESSAGE', messageId: 'message-a' },
        projectId: 'project-a',
        status: 'FAILED',
      })
      .mockResolvedValueOnce(null);

    await expect(
      test.service.retry(
        'failed-operation-a',
        {
          crmProjectId: 'crm-project-a',
          omnicusProjectId: 'project-a',
          retryRequestId: 'retry-a',
        },
        'correlation-a',
      ),
    ).resolves.toEqual({
      messageId: 'message-a',
      operationId: 'operation-a',
      replayed: false,
      status: 'QUEUED',
    });
    expect(test.queue.enqueue).toHaveBeenCalledWith('operation-a');
  });
});
