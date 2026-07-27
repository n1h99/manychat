import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const schema = readFileSync(resolve(packageRoot, 'prisma/schema.prisma'), 'utf8');

describe('Telegram broadcast persistence schema', () => {
  it('keeps broadcast recipients tenant-bound and idempotent', () => {
    expect(schema).toContain('model Broadcast {');
    expect(schema).toContain('model BroadcastRecipient {');
    expect(schema).toContain('@@unique([projectId, broadcastId, channelIdentityId])');
    expect(schema).toMatch(
      /connection\s+ChannelConnection\s+@relation\(fields: \[projectId, connectionId\], references: \[projectId, id\], onDelete: Restrict\)/,
    );
    expect(schema).toContain('@@unique([projectId, outboxRecordId])');
  });

  it('uses PostgreSQL timestamps and status indexes for broadcast recovery', () => {
    expect(schema).toContain('enum BroadcastStatus {');
    expect(schema).toContain('enum BroadcastRecipientStatus {');
    expect(schema).toContain('@@index([projectId, status, scheduledAt])');
    expect(schema).toContain('@@index([projectId, broadcastId, status])');
    expect(schema).toContain('@db.Timestamptz(3)');
  });
});
