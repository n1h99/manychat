import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

export interface DatabaseHandle {
  client: PrismaClient;
  close: () => Promise<void>;
}

export function createDatabaseHandle(databaseUrl: string): DatabaseHandle {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: 10,
  });
  const client = new PrismaClient({ adapter });

  return {
    client,
    close: async () => {
      await client.$disconnect();
    },
  };
}

export type { PrismaClient };
