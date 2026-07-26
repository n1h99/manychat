import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { telegramInboundFixtures } from '@omnicus/test-fixtures';
import { createDatabaseHandle } from '@omnicus/database';
import type { DatabaseHandle, Prisma } from '@omnicus/database';
import { validateWorkerEnvironment, type WorkerEnvironment } from '@omnicus/config/server';
import {
  TELEGRAM_INBOUND_QUEUE_NAME,
  telegramInboundJobIdFor,
  type TelegramInboundJob,
} from '@omnicus/channel-telegram';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { redisConnectionFromUrl } from '../queue/redis-connection';
import { TelegramInboundProcessorService } from './telegram-inbound-processor.service';
import { TelegramInboundRecoveryService } from './telegram-inbound-recovery.service';

const TEST_CHANNEL_SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');
const integrationDescribe =
  process.env.RUN_SERVICE_INTEGRATION === 'true'
    ? describe
    : process.env.CI === 'true'
      ? describe
      : describe.skip;

integrationDescribe('Telegram inbound persistence integration', () => {
  let handle: DatabaseHandle | undefined;
  let projectId = '';
  let connectionId = '';
  let service: TelegramInboundProcessorService | undefined;
  let recovery: TelegramInboundRecoveryService | undefined;
  let queue: Queue<TelegramInboundJob> | undefined;

  beforeAll(async () => {
    const environment = validateWorkerEnvironment({
      ...process.env,
      APP_ENV: 'test',
      CHANNEL_SECRETS_KEY: TEST_CHANNEL_SECRETS_KEY,
      DEMO_JOB_ENABLED: 'false',
      NODE_ENV: 'test',
    });
    handle = createDatabaseHandle(environment.DATABASE_URL);
    projectId = randomUUID();
    connectionId = randomUUID();
    await handle.client.project.create({
      data: {
        id: projectId,
        locale: 'en',
        name: `Telegram integration ${projectId}`,
        settings: {},
        slug: `telegram-integration-${projectId}`,
        timezone: 'UTC',
      },
    });
    await handle.client.channelConnection.create({
      data: {
        credentialsEncrypted: {},
        id: connectionId,
        projectId,
        status: 'ACTIVE',
        webhookSecretEncrypted: {},
      },
    });
    const config = new ConfigService<WorkerEnvironment, true>(environment);
    service = new TelegramInboundProcessorService(config, { client: handle.client } as never);
    recovery = new TelegramInboundRecoveryService(config, { client: handle.client } as never);
    await recovery.onApplicationBootstrap();
    queue = new Queue<TelegramInboundJob>(TELEGRAM_INBOUND_QUEUE_NAME, {
      connection: redisConnectionFromUrl(environment.REDIS_URL),
    });
  });

  afterAll(async () => {
    if (queue) await queue.close();
    if (recovery) await recovery.onApplicationShutdown();
    if (handle && projectId) {
      await handle.client.message.deleteMany({ where: { projectId } });
      await handle.client.normalizedEvent.deleteMany({ where: { projectId } });
      await handle.client.inboxRecord.deleteMany({ where: { projectId } });
      await handle.client.rawWebhookEvent.deleteMany({ where: { projectId } });
      await handle.client.conversation.deleteMany({ where: { projectId } });
      await handle.client.channelIdentity.deleteMany({ where: { projectId } });
      await handle.client.contact.deleteMany({ where: { projectId } });
      await handle.client.channelConnection.deleteMany({ where: { projectId } });
      await handle.client.project.deleteMany({ where: { id: projectId } });
    }
    if (handle) await handle.close();
  });

  it('persists one contact, identity, conversation, message, and normalized event across redelivery', async () => {
    if (!handle || !service) throw new Error('Telegram integration setup did not complete');
    const rawId = randomUUID();
    const inboxId = randomUUID();
    await handle.client.rawWebhookEvent.create({
      data: {
        connectionId,
        correlationId: `test-${rawId}`,
        externalUpdateId: `update-${rawId}`,
        id: rawId,
        payload: telegramInboundFixtures.text.payload as Prisma.InputJsonValue,
        projectId,
        purgeAfter: new Date(Date.now() + 60_000),
      },
    });
    await handle.client.inboxRecord.create({
      data: {
        connectionId,
        id: inboxId,
        nextAttemptAt: new Date(),
        projectId,
        rawWebhookEventId: rawId,
      },
    });

    await service.process({ inboxRecordId: inboxId });
    await service.process({ inboxRecordId: inboxId });

    await expect(
      handle.client.inboxRecord.findUniqueOrThrow({ where: { id: inboxId } }),
    ).resolves.toMatchObject({
      attempts: 1,
      status: 'COMPLETED',
    });
    await expect(handle.client.contact.count({ where: { projectId } })).resolves.toBe(1);
    await expect(handle.client.channelIdentity.count({ where: { projectId } })).resolves.toBe(1);
    await expect(handle.client.conversation.count({ where: { projectId } })).resolves.toBe(1);
    await expect(handle.client.message.count({ where: { projectId } })).resolves.toBe(1);
    await expect(handle.client.normalizedEvent.count({ where: { projectId } })).resolves.toBe(1);
  });

  it('re-enqueues a PostgreSQL pending record after a lost webhook enqueue', async () => {
    if (!handle || !recovery || !queue)
      throw new Error('Telegram recovery integration setup did not complete');
    const rawId = randomUUID();
    const inboxId = randomUUID();
    await handle.client.rawWebhookEvent.create({
      data: {
        connectionId,
        correlationId: `test-${rawId}`,
        externalUpdateId: `lost-${rawId}`,
        id: rawId,
        payload: telegramInboundFixtures.text.payload as Prisma.InputJsonValue,
        projectId,
        purgeAfter: new Date(Date.now() + 60_000),
      },
    });
    await handle.client.inboxRecord.create({
      data: {
        connectionId,
        id: inboxId,
        nextAttemptAt: new Date(),
        projectId,
        rawWebhookEventId: rawId,
      },
    });

    await recovery.scanOnce();

    const job = await queue.getJob(telegramInboundJobIdFor(inboxId));
    expect(job?.data).toEqual({ inboxRecordId: inboxId });
    await job?.remove();
  });
});
