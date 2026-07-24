import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config';
import type { HealthDependency } from '@omnicus/contracts';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthService implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(
    @Inject(ConfigService)
    config: ConfigService<ApiEnvironment, true>,
  ) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      connectTimeout: 3_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async check(): Promise<HealthDependency> {
    const startedAt = performance.now();
    if (this.redis.status === 'wait') {
      await this.redis.connect();
    }
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
