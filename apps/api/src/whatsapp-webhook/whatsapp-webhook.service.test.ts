import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { WhatsAppWebhookService } from './whatsapp-webhook.service';

const secret = 'meta-app-secret';
const secretWithWhitespace = '  meta-app-secret  ';
const shortSecret = 'short-secret';
const userAgent = 'meta-simulator';
const ipAddress = '203.0.113.10';

function signature(raw: Buffer, appSecret: string = secret): string {
  return `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
}

function setup(
  connection: { id: string; projectId: string } | null = {
    id: 'connection-a',
    projectId: 'project-a',
  },
  appSecret?: string,
) {
  let sequence = 0;
  const transaction = {
    inboxRecord: {
      create: vi.fn().mockImplementation(async () => ({ id: `inbox-${++sequence}` })),
    },
    rawWebhookEvent: {
      create: vi.fn().mockImplementation(async () => ({ id: `raw-${sequence + 1}` })),
    },
  };
  const client = {
    $transaction: vi.fn().mockImplementation(async (callback) => callback(transaction)),
    channelConnection: {
      findFirst: vi.fn().mockResolvedValue(connection),
      update: vi.fn(),
    },
    inboxRecord: { update: vi.fn() },
  };
  const audit = { record: vi.fn() };
  const queue = { enqueue: vi.fn() };
  const config = {
    get: vi.fn((key: string) =>
      key === 'WHATSAPP_META_APP_SECRET'
        ? appSecret === undefined
          ? secret
          : appSecret
        : key === 'WHATSAPP_META_WEBHOOK_VERIFY_TOKEN'
          ? 'verify-token'
          : undefined,
    ),
  };
  return {
    audit,
    client,
    queue,
    service: new WhatsAppWebhookService(
      config as never,
      { client } as never,
      audit as never,
      queue as never,
    ),
    transaction,
  };
}

function getWarnLog(service: WhatsAppWebhookService) {
  const logger = vi.spyOn(
    (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger,
    'warn',
  );
  return logger;
}

function getWarnPayload(warn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(warn).toHaveBeenCalledOnce();
  const log = warn.mock.calls[0]?.[0];
  expect(log).toBeTypeOf('string');
  expect(typeof log).toBe('string');
  return JSON.parse(log as string) as Record<string, unknown>;
}

function envelope() {
  return {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '10' },
              messages: [
                { from: '20', id: 'wamid.one', text: { body: 'one' }, type: 'text' },
                { from: '20', id: 'wamid.two', text: { body: 'two' }, type: 'text' },
              ],
            },
          },
        ],
        id: '30',
      },
    ],
    object: 'whatsapp_business_account',
  };
}

describe('WhatsAppWebhookService', () => {
  it('accepts the exact verification token and rejects a mismatch', () => {
    const test = setup();
    expect(test.service.verifyChallenge('subscribe', 'verify-token', 'challenge')).toBe(
      'challenge',
    );
    expect(() => test.service.verifyChallenge('subscribe', 'wrong', 'challenge')).toThrow();
  });

  it('rejects a missing signature header with structured safe diagnostics', async () => {
    const test = setup();
    const warn = getWarnLog(test.service);
    const payload = envelope();
    await expect(
      test.service.receive(Buffer.from(JSON.stringify(payload)), undefined, payload, {
        correlationId: 'correlation-a',
        ip: ipAddress,
        userAgent,
      }),
    ).rejects.toMatchObject({ response: { code: 'WHATSAPP_WEBHOOK_SIGNATURE_REJECTED' } });
    const log = getWarnPayload(warn);
    expect(log).toMatchObject({
      correlationId: 'correlation-a',
      signaturePresent: false,
      signatureHasSha256Prefix: false,
      signatureHexLength: null,
      signatureHexValid: false,
      appSecretLength: secret.length,
      appSecretPresent: true,
      rawBodyPresent: true,
      rawBodyLength: JSON.stringify(payload).length,
      safeReason: 'SIGNATURE_HEADER_MISSING',
      ip: ipAddress,
      userAgent,
    });
    expect(test.audit.record).toHaveBeenCalledOnce();
    expect(test.client.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature prefix with structured safe diagnostics', async () => {
    const test = setup();
    const warn = getWarnLog(test.service);
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, 'md5=abcdef', payload, {
        correlationId: 'correlation-a',
        ip: ipAddress,
        userAgent,
      }),
    ).rejects.toMatchObject({ response: { code: 'WHATSAPP_WEBHOOK_SIGNATURE_REJECTED' } });
    const log = getWarnPayload(warn);
    expect(log).toMatchObject({
      correlationId: 'correlation-a',
      signaturePresent: true,
      signatureHasSha256Prefix: false,
      signatureHexLength: null,
      signatureHexValid: false,
      safeReason: 'SIGNATURE_PREFIX_INVALID',
      rawBodyLength: raw.length,
      appSecretLength: secret.length,
    });
  });

  it('rejects a signature with invalid hex content with structured safe diagnostics', async () => {
    const test = setup();
    const warn = getWarnLog(test.service);
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, `sha256=${'zz'.repeat(32)}`, payload, {
        correlationId: 'correlation-a',
        ip: ipAddress,
        userAgent,
      }),
    ).rejects.toMatchObject({ response: { code: 'WHATSAPP_WEBHOOK_SIGNATURE_REJECTED' } });
    const log = getWarnPayload(warn);
    expect(log).toMatchObject({
      correlationId: 'correlation-a',
      signaturePresent: true,
      signatureHasSha256Prefix: true,
      signatureHexLength: 64,
      signatureHexValid: false,
      safeReason: 'SIGNATURE_HEX_INVALID',
      rawBodyLength: raw.length,
      appSecretLength: secret.length,
    });
  });

  it('rejects a signature with invalid length with structured safe diagnostics', async () => {
    const test = setup();
    const warn = getWarnLog(test.service);
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, `sha256=${'a'.repeat(63)}`, payload, {
        correlationId: 'correlation-a',
        ip: ipAddress,
        userAgent,
      }),
    ).rejects.toMatchObject({ response: { code: 'WHATSAPP_WEBHOOK_SIGNATURE_REJECTED' } });
    const log = getWarnPayload(warn);
    expect(log).toMatchObject({
      correlationId: 'correlation-a',
      signaturePresent: true,
      signatureHasSha256Prefix: true,
      signatureHexLength: 63,
      signatureHexValid: true,
      safeReason: 'SIGNATURE_LENGTH_INVALID',
      rawBodyLength: raw.length,
      appSecretLength: secret.length,
    });
  });

  it('rejects a signature mismatch with structured safe diagnostics', async () => {
    const test = setup();
    const warn = getWarnLog(test.service);
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, `sha256=${'a'.repeat(64)}`, payload, {
        correlationId: 'correlation-a',
        ip: ipAddress,
        userAgent,
      }),
    ).rejects.toMatchObject({ response: { code: 'WHATSAPP_WEBHOOK_SIGNATURE_REJECTED' } });
    const log = getWarnPayload(warn);
    expect(log).toMatchObject({
      correlationId: 'correlation-a',
      signaturePresent: true,
      signatureHasSha256Prefix: true,
      signatureHexLength: 64,
      signatureHexValid: true,
      safeReason: 'SIGNATURE_MISMATCH',
      rawBodyLength: raw.length,
      appSecretLength: secret.length,
    });
  });

  it('persists and enqueues every bounded item without undefined JSON properties', async () => {
    const test = setup();
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, signature(raw), payload, { correlationId: 'correlation-a' }),
    ).resolves.toMatchObject({ accepted: true, persisted: 2, unknownConnections: 0 });
    expect(test.transaction.rawWebhookEvent.create).toHaveBeenCalledTimes(2);
    expect(test.queue.enqueue).toHaveBeenCalledTimes(2);
    for (const call of test.transaction.rawWebhookEvent.create.mock.calls)
      expect(JSON.stringify(call[0].data.payload)).not.toContain('undefined');
  });

  it('accepts a short WhatsApp app secret when validating webhook signatures', async () => {
    const test = setup(undefined, shortSecret);
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, signature(raw, shortSecret), payload, {
        correlationId: 'correlation-a',
      }),
    ).resolves.toMatchObject({ accepted: true, persisted: 2, unknownConnections: 0 });
  });

  it('acknowledges an unknown phone without storing its payload', async () => {
    const test = setup(null);
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, signature(raw), payload, { correlationId: 'correlation-a' }),
    ).resolves.toMatchObject({ persisted: 0, unknownConnections: 2 });
    expect(test.client.$transaction).not.toHaveBeenCalled();
    expect(test.queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects webhook processing when WhatsApp Meta app secret is empty', async () => {
    const test = setup(undefined, '');
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, signature(raw, ''), payload, { correlationId: 'correlation-a' }),
    ).rejects.toMatchObject({
      response: { code: 'WHATSAPP_META_CONFIGURATION_REQUIRED' },
    });
  });

  it('returns a deterministic error for an oversized signed envelope', async () => {
    const test = setup();
    const payload = {
      entry: Array.from({ length: 101 }, () => ({ changes: [], id: '30' })),
      object: 'whatsapp_business_account',
    };
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(
      test.service.receive(raw, signature(raw), payload, { correlationId: 'correlation-a' }),
    ).rejects.toMatchObject({ response: { code: 'WHATSAPP_WEBHOOK_ENVELOPE_OVERSIZED' } });
    expect(test.client.$transaction).not.toHaveBeenCalled();
  });

  it('does not include the app secret in webhook signature rejection messages', async () => {
    const test = setup(undefined, secretWithWhitespace);
    const payload = envelope();
    const raw = Buffer.from(JSON.stringify(payload));
    const warn = getWarnLog(test.service);
    try {
      await test.service.receive(raw, 'sha256=not-a-signature', payload, {
        correlationId: 'correlation-a',
      });
      throw new Error('expected rejection');
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(secretWithWhitespace);
      expect(serialized).not.toContain(secret.trim());
      const log = getWarnPayload(warn);
      const logSerialized = JSON.stringify(log);
      expect(logSerialized).not.toContain(secretWithWhitespace);
      expect(logSerialized).not.toContain(secret.trim());
      expect(logSerialized).not.toContain('not-a-signature');
      expect(logSerialized).not.toContain(raw.toString());
    }
  });
});
