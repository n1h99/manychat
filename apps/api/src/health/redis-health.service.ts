import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';
import type { HealthDependency } from '@omnicus/contracts';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthService implements OnApplicationShutdown {
  private readonly redis: Redis;
  private connectionAttempt: Promise<void> | undefined;

  constructor(
    @Inject(ConfigService)
    config: ConfigService<ApiEnvironment, true>,
  ) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      commandTimeout: 3_000,
      connectTimeout: 3_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'ready') {
      return;
    }

    this.connectionAttempt ??= this.redis.connect().finally(() => {
      this.connectionAttempt = undefined;
    });
    await this.connectionAttempt;
  }

  async check(): Promise<HealthDependency> {
    const startedAt = performance.now();
    await this.ensureConnected();
    await this.redis.ping();
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: 'up',
    };
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
