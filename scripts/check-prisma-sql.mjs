import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const pnpmExecutable = process.env.npm_execpath;

if (!pnpmExecutable || !/(?:corepack|pnpm)/i.test(pnpmExecutable)) {
  throw new Error('Run this check through the repository pnpm command');
}

const result = spawnSync(
  process.execPath,
  [
    pnpmExecutable,
    '--filter',
    '@omnicus/database',
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
  ],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://prisma_validation:prisma_validation@127.0.0.1:5432/omnicus_validation',
    },
  },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const sql = result.stdout.replaceAll('\r\n', '\n');
const failures = [];
const proposalPath = resolve(repositoryRoot, 'docs/STAGE1_BASELINE_SQL_PROPOSAL.sql');
const proposal = readFileSync(proposalPath, 'utf8').replaceAll('\r\n', '\n');
const proposalSql = proposal.slice(proposal.indexOf('-- CreateSchema')).trim();
const expectedTables = new Set([
  'audit_logs',
  'global_active_invite_reservations',
  'global_role_permissions',
  'global_roles',
  'global_user_invite_tokens',
  'global_user_roles',
  'password_reset_tokens',
  'permissions',
  'project_memberships',
  'project_active_invite_reservations',
  'project_role_permissions',
  'project_roles',
  'project_user_invite_tokens',
  'projects',
  'sessions',
  'users',
  'contacts',
  'channel_identities',
  'tags',
  'contact_tags',
  'custom_field_definitions',
  'channel_connections',
  'raw_webhook_events',
  'inbox_records',
  'normalized_events',
  'conversations',
  'messages',
  'outbox_records',
  'idempotency_records',
]);
const generatedTables = new Set(
  [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]),
);

if (
  generatedTables.size !== expectedTables.size ||
  [...expectedTables].some((table) => !generatedTables.has(table))
) {
  failures.push(`Stage 3 table slice differs: ${[...generatedTables].sort().join(', ')}`);
}

const requiredSql = [
  'CREATE TABLE "global_active_invite_reservations"',
  'CREATE TABLE "project_active_invite_reservations"',
  'CREATE UNIQUE INDEX "global_active_invite_reservations_inviteTokenId_key"',
  'CREATE UNIQUE INDEX "project_active_invite_reservations_inviteTokenId_key"',
  'CREATE UNIQUE INDEX "sessions_replacedBySessionId_userId_tokenFamilyId_key"',
  'CREATE INDEX "global_role_permissions_permissionId_idx"',
  'CREATE INDEX "project_role_permissions_permissionId_idx"',
  'CREATE INDEX "global_user_roles_createdById_idx"',
  'CREATE INDEX "project_memberships_createdById_idx"',
  'CREATE INDEX "global_user_invite_tokens_invitedById_idx"',
  'CREATE INDEX "project_user_invite_tokens_invitedById_idx"',
  'ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT',
  'FOREIGN KEY ("replacedBySessionId", "userId", "tokenFamilyId") REFERENCES "sessions"("id", "userId", "tokenFamilyId") ON DELETE RESTRICT',
  'FOREIGN KEY ("projectId", "projectRoleId") REFERENCES "project_roles"("projectId", "id") ON DELETE RESTRICT',
  'FOREIGN KEY ("projectId", "projectRoleId") REFERENCES "project_roles"("projectId", "id") ON DELETE CASCADE',
  'ALTER TABLE "global_role_permissions" ADD CONSTRAINT',
  'REFERENCES "global_roles"("id") ON DELETE CASCADE',
  'ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_projectId_fkey"',
  'REFERENCES "projects"("id") ON DELETE RESTRICT',
  'ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT',
  'ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT',
  'ALTER TABLE "project_user_invite_tokens" ADD CONSTRAINT "project_user_invite_tokens_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT',
  'FOREIGN KEY ("inviteTokenId", "globalRoleId") REFERENCES "global_user_invite_tokens"("id", "globalRoleId") ON DELETE CASCADE',
  'FOREIGN KEY ("projectId", "inviteTokenId") REFERENCES "project_user_invite_tokens"("projectId", "id") ON DELETE CASCADE',
];

for (const fragment of requiredSql) {
  if (!sql.includes(fragment)) {
    failures.push(`Generated SQL is missing invariant: ${fragment}`);
  }
}

if (sql.includes('CREATE TABLE "roles"') || sql.includes('CREATE TABLE "role_permissions"')) {
  failures.push('Rejected nullable-scope RBAC tables reappeared');
}

if (sql.includes('CONSTRAINT "sessions_replacedBySessionId_fkey"')) {
  failures.push('Session rotation lost its user/token-family boundary');
}

if (sql.includes('audit_logs_projectId_id_key')) {
  failures.push('Dual-scope audit log regained a misleading nullable composite unique');
}

if (
  sql.includes('WHERE ("acceptedAt" IS NULL AND "revokedAt" IS NULL)') ||
  sql.includes('global_invites_active_email_role_key') ||
  sql.includes('project_invites_active_email_key')
) {
  failures.push('Partial invitation unique selectors reappeared in the Prisma diff');
}

if (sql.includes('TIMESTAMP(3) ') || sql.includes('TIMESTAMP(3),')) {
  failures.push('A lifecycle timestamp was generated without time zone');
}

if (/\bDROP\s+(?:TABLE|TYPE|INDEX|COLUMN)\b/i.test(sql)) {
  failures.push('Fresh schema diff contains a destructive operation');
}

const migrationPath = resolve(
  repositoryRoot,
  'packages/database/prisma/migrations/20260726000100_stage1_auth_rbac_projects/migration.sql',
);
if (!existsSync(migrationPath)) {
  failures.push('Stage 1 initial migration is missing');
} else {
  const migrationSql = readFileSync(migrationPath, 'utf8').replaceAll('\r\n', '\n');
  if (!migrationSql.includes('CREATE TABLE "users"')) {
    failures.push('Stage 1 initial migration is malformed');
  }
}

const stage2MigrationPath = resolve(
  repositoryRoot,
  'packages/database/prisma/migrations/20260726000200_stage2_contacts_tags_fields/migration.sql',
);
if (!existsSync(stage2MigrationPath)) {
  failures.push('Stage 2 contacts migration is missing');
} else {
  const stage2MigrationSql = readFileSync(stage2MigrationPath, 'utf8').replaceAll('\r\n', '\n');
  for (const fragment of [
    'CREATE TABLE "contacts"',
    'CREATE TABLE "channel_identities"',
    'CREATE TABLE "tags"',
    'CREATE TABLE "contact_tags"',
    'CREATE TABLE "custom_field_definitions"',
    'FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id")',
    'FOREIGN KEY ("projectId", "tagId") REFERENCES "tags"("projectId", "id")',
    '"customFields" JSONB NOT NULL DEFAULT \'{}\'',
    'TIMESTAMPTZ(3)',
  ]) {
    if (!stage2MigrationSql.includes(fragment))
      failures.push(`Stage 2 migration is missing invariant: ${fragment}`);
  }
}

const stage3MigrationPath = resolve(
  repositoryRoot,
  'packages/database/prisma/migrations/20260726000300_stage3_telegram_persistence/migration.sql',
);
if (!existsSync(stage3MigrationPath)) {
  failures.push('Stage 3 Telegram persistence migration is missing');
} else {
  const stage3MigrationSql = readFileSync(stage3MigrationPath, 'utf8').replaceAll('\r\n', '\n');
  for (const fragment of [
    'CREATE TABLE "channel_connections"',
    'CREATE TABLE "raw_webhook_events"',
    'CREATE TABLE "inbox_records"',
    'CREATE TABLE "normalized_events"',
    'CREATE TABLE "conversations"',
    'CREATE TABLE "messages"',
    'CREATE TABLE "outbox_records"',
    'CREATE TABLE "idempotency_records"',
    'CREATE UNIQUE INDEX "raw_webhook_events_connectionId_externalUpdateId_key"',
    'CREATE UNIQUE INDEX "normalized_events_inboxRecordId_key"',
    'CREATE UNIQUE INDEX "conversations_projectId_connectionId_externalChatId_key"',
    'CREATE UNIQUE INDEX "messages_connectionId_direction_externalMessageId_key"',
    'CREATE UNIQUE INDEX "messages_projectId_normalizedEventId_key"',
    'FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id")',
    'FOREIGN KEY ("projectId", "rawWebhookEventId") REFERENCES "raw_webhook_events"("projectId", "id")',
    'FOREIGN KEY ("projectId", "inboxRecordId") REFERENCES "inbox_records"("projectId", "id")',
    'FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id")',
    'FOREIGN KEY ("projectId", "conversationId") REFERENCES "conversations"("projectId", "id")',
    'FOREIGN KEY ("projectId", "normalizedEventId") REFERENCES "normalized_events"("projectId", "id")',
    '"credentialsEncrypted" JSONB NOT NULL',
    '"webhookSecretEncrypted" JSONB NOT NULL',
    'TIMESTAMPTZ(3)',
  ]) {
    if (!stage3MigrationSql.includes(fragment)) {
      failures.push(`Stage 3 migration is missing invariant: ${fragment}`);
    }
  }

  for (const forbidden of ['botToken', 'webhookSecret" TEXT', 'plaintext']) {
    if (stage3MigrationSql.includes(forbidden)) {
      failures.push(`Stage 3 migration contains forbidden secret storage: ${forbidden}`);
    }
  }

  if (/\bDROP\s+(?:TABLE|TYPE|INDEX|COLUMN)\b/i.test(stage3MigrationSql)) {
    failures.push('Stage 3 migration contains a destructive operation');
  }
}

if (!proposalSql.includes('CREATE TABLE "users"')) {
  failures.push('Committed Stage 1 SQL proposal is malformed');
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    check: 'stage3-sql-diff',
    migrationCreated: true,
    status: 'passed',
    tables: [...generatedTables].sort(),
  })}\n`,
);
