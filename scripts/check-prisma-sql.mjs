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
  'global_role_permissions',
  'global_roles',
  'global_user_invite_tokens',
  'global_user_roles',
  'password_reset_tokens',
  'permissions',
  'project_memberships',
  'project_role_permissions',
  'project_roles',
  'project_user_invite_tokens',
  'projects',
  'sessions',
  'users',
]);
const generatedTables = new Set(
  [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]),
);

if (
  generatedTables.size !== expectedTables.size ||
  [...expectedTables].some((table) => !generatedTables.has(table))
) {
  failures.push(`Stage 1 table slice differs: ${[...generatedTables].sort().join(', ')}`);
}

const requiredSql = [
  'CREATE UNIQUE INDEX "global_invites_active_email_role_key"',
  'CREATE UNIQUE INDEX "project_invites_active_email_key"',
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
  'WHERE ("acceptedAt" IS NULL AND "revokedAt" IS NULL)',
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

if (sql.includes('TIMESTAMP(3) ') || sql.includes('TIMESTAMP(3),')) {
  failures.push('A lifecycle timestamp was generated without time zone');
}

if (existsSync(resolve(repositoryRoot, 'packages/database/prisma/migrations'))) {
  failures.push('A Prisma migrations directory exists during the Stage 0 migration gate');
}

if (proposalSql !== sql.trim()) {
  failures.push('Committed Stage 1 SQL proposal differs from the generated Prisma diff');
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    check: 'stage1-sql-diff',
    migrationCreated: false,
    status: 'passed',
    tables: [...generatedTables].sort(),
  })}\n`,
);
