import { defineConfig } from 'prisma/config';
import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

loadEnvironment({ path: resolve(__dirname, '../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Validation/generation scripts inject an explicit non-connecting placeholder.',
  );
}

const parsedDatabaseUrl = new URL(databaseUrl);
if (parsedDatabaseUrl.protocol !== 'postgres:' && parsedDatabaseUrl.protocol !== 'postgresql:') {
  throw new Error('DATABASE_URL must use postgres:// or postgresql://');
}

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'node ../../scripts/pnpm.mjs --filter @omnicus/database db:seed',
  },
  schema: 'prisma/schema.prisma',
});
