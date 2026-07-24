import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const pnpmExecutable = process.env.npm_execpath;
const prismaArguments = process.argv.slice(2);
const command = prismaArguments[0];
const placeholderAllowed =
  command === 'format' ||
  command === 'generate' ||
  command === 'validate' ||
  (command === 'migrate' && prismaArguments[1] === 'diff');

if (!pnpmExecutable || !/(?:corepack|pnpm)/i.test(pnpmExecutable)) {
  throw new Error('Run Prisma commands through the repository pnpm scripts');
}

if (!command) {
  throw new Error('A Prisma command is required');
}

const environment = { ...process.env };

if (command === 'generate') {
  const generatedClientDirectory = resolve(
    import.meta.dirname,
    '../packages/database/src/generated/prisma',
  );
  const allowedGeneratedRoot = resolve(import.meta.dirname, '../packages/database/src/generated');

  if (!generatedClientDirectory.startsWith(`${allowedGeneratedRoot}${sep}`)) {
    throw new Error('Refusing to clean Prisma output outside the generated source directory');
  }
  rmSync(generatedClientDirectory, { force: true, recursive: true });
}

if (!environment.DATABASE_URL) {
  if (!placeholderAllowed) {
    throw new Error(
      `DATABASE_URL is required for prisma ${prismaArguments.join(' ')}; no local fallback is allowed`,
    );
  }

  environment.DATABASE_URL =
    'postgresql://prisma_validation:prisma_validation@127.0.0.1:5432/omnicus_validation';
  environment.PRISMA_VALIDATION_PLACEHOLDER = 'true';
  process.stdout.write(
    `${JSON.stringify({
      command: `prisma ${prismaArguments.join(' ')}`,
      database: 'explicit-non-connecting-placeholder',
      level: 'log',
    })}\n`,
  );
}

const databaseUrl = new URL(environment.DATABASE_URL);
if (databaseUrl.protocol !== 'postgres:' && databaseUrl.protocol !== 'postgresql:') {
  throw new Error('DATABASE_URL must use postgres:// or postgresql://');
}

const result = spawnSync(
  process.execPath,
  [pnpmExecutable, '--filter', '@omnicus/database', 'exec', 'prisma', ...prismaArguments],
  {
    encoding: 'utf8',
    env: environment,
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
