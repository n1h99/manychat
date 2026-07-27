import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const schema = readFileSync(resolve(packageRoot, 'prisma/schema.prisma'), 'utf8');

describe('Stage 3 Telegram persistence schema', () => {
  it('uses encrypted envelopes and tenant-safe connection relations', () => {
    expect(schema).toContain('credentialsEncrypted   Json');
    expect(schema).toContain('webhookSecretEncrypted Json');
    expect(schema).not.toMatch(/\b(botToken|webhookSecret)\s+String/);
    expect(schema).toContain('references: [projectId, id], onDelete: Restrict');
  });

  it('defines stable idempotency boundaries for webhook processing', () => {
    expect(schema).toContain('@@unique([connectionId, externalUpdateId])');
    expect(schema).toMatch(/inboxRecordId\s+String\s+@unique/);
    expect(schema).toContain('@@unique([projectId, connectionId, externalChatId])');
    expect(schema).toContain('@@unique([projectId, normalizedEventId])');
    expect(schema).toContain('@@unique([connectionId, direction, externalMessageId])');
  });

  it('keeps inbox and outbox records leaseable and recoverable', () => {
    for (const field of [
      'maxAttempts',
      'nextAttemptAt',
      'lockedAt',
      'lockedBy',
      'lastError',
      'completedAt',
    ]) {
      expect(schema).toContain(field);
    }

    expect(schema).toContain('@@index([status, nextAttemptAt])');
  });
});
