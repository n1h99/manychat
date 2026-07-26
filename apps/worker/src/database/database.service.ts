import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabaseHandle, type DatabaseHandle, type PrismaClient } from '@omnicus/database';
import type { WorkerEnvironment } from '@omnicus/config/server';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly handle: DatabaseHandle;

  constructor(@Inject(ConfigService) config: ConfigService<WorkerEnvironment, true>) {
    this.handle = createDatabaseHandle(config.get('DATABASE_URL', { infer: true }));
  }

  get client(): PrismaClient {
    return this.handle.client;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
