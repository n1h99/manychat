import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config';
import type { HealthDependency } from '@omnicus/contracts';
import { createDatabaseHandle, type DatabaseHandle } from '@omnicus/database';

@Injectable()
export class DatabaseHealthService implements OnApplicationShutdown {
  private readonly handle: DatabaseHandle;

  constructor(
    @Inject(ConfigService)
    config: ConfigService<ApiEnvironment, true>,
  ) {
    this.handle = createDatabaseHandle(config.get('DATABASE_URL', { infer: true }));
  }

  async check(): Promise<HealthDependency> {
    const startedAt = performance.now();
    await this.handle.client.$queryRaw`SELECT 1`;
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: 'up',
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
