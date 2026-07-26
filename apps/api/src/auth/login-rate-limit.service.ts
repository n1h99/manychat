import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';

@Injectable()
export class LoginRateLimitService implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      connectTimeout: 3_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
  }

  async assertAllowed(identifier: string): Promise<void> {
    const maxAttempts = this.config.get('LOGIN_RATE_LIMIT_MAX_ATTEMPTS', { infer: true });
    const windowSeconds = this.config.get('LOGIN_RATE_LIMIT_WINDOW_SECONDS', { infer: true });
    const key = `auth:login:${createHash('sha256').update(identifier).digest('hex')}`;
    if (this.redis.status !== 'ready') {
      await this.redis.connect();
    }
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    if (attempts > maxAttempts) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many login attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async clear(identifier: string): Promise<void> {
    const key = `auth:login:${createHash('sha256').update(identifier).digest('hex')}`;
    if (this.redis.status === 'ready') {
      await this.redis.del(key);
    }
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
