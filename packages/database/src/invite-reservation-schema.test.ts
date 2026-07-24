import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const schema = readFileSync(resolve(packageRoot, 'prisma/schema.prisma'), 'utf8');
const generatedGlobalInviteModel = readFileSync(
  resolve(packageRoot, 'src/generated/prisma/models/GlobalUserInviteToken.ts'),
  'utf8',
);
const generatedProjectInviteModel = readFileSync(
  resolve(packageRoot, 'src/generated/prisma/models/ProjectUserInviteToken.ts'),
  'utf8',
);

describe('active invitation reservation schema', () => {
  it('uses primary-key reservations instead of Prisma partial unique selectors', () => {
    expect(schema).not.toContain('previewFeatures = ["partialIndexes"]');
    expect(schema).not.toContain('where: raw(');
    expect(schema).toContain('model GlobalActiveInviteReservation');
    expect(schema).toContain('@@id([normalizedEmail, globalRoleId])');
    expect(schema).toContain('model ProjectActiveInviteReservation');
    expect(schema).toContain('@@id([projectId, normalizedEmail])');
    expect(schema.match(/inviteTokenId\s+String\s+@unique/g)).toHaveLength(2);
  });

  it('does not generate a historical-invitation compound WhereUnique selector', () => {
    expect(generatedGlobalInviteModel).not.toContain('normalizedEmail_globalRoleId');
    expect(generatedProjectInviteModel).not.toContain('projectId_normalizedEmail');
  });
});
