import { Module } from '@nestjs/common';

import { DatabaseHealthService } from './database-health.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisHealthService } from './redis-health.service';

@Module({
  controllers: [HealthController],
  exports: [DatabaseHealthService, RedisHealthService],
  providers: [DatabaseHealthService, RedisHealthService, HealthService],
})
export class HealthModule {}
