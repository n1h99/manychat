import { defineConfig } from 'prisma/config';
import { config as loadEnvironment } from 'dotenv';

loadEnvironment({ path: '../../.env', quiet: true });

const localDatabaseUrl = 'postgresql://omnicus:omnicus@localhost:5432/omnicus?schema=public';

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'pnpm db:seed',
  },
  schema: 'prisma/schema.prisma',
});
