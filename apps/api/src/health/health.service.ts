import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ReadinessData } from '@omnicus/contracts';

import { DatabaseHealthService } from './database-health.service';
import { RedisHealthService } from './redis-health.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DatabaseHealthService)
    private readonly database: DatabaseHealthService,
    @Inject(RedisHealthService)
    private readonly redis: RedisHealthService,
  ) {}

  async readiness(): Promise<ReadinessData> {
    const [database, redis] = await Promise.allSettled([this.database.check(), this.redis.check()]);

    if (database.status === 'rejected' || redis.status === 'rejected') {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        details: {
          database: database.status === 'fulfilled' ? database.value : { status: 'down' },
          redis: redis.status === 'fulfilled' ? redis.value : { status: 'down' },
        },
        message: 'One or more required dependencies are unavailable',
      });
    }

    return {
      dependencies: {
        database: database.value,
        redis: redis.value,
      },
      status: 'ready',
    };
  }
}
