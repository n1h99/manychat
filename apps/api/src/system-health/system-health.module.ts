import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { HealthModule } from '../health/health.module';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';

@Module({
  controllers: [SystemHealthController],
  imports: [AccessModule, AuditModule, HealthModule, JwtModule.register({})],
  providers: [SystemHealthService],
})
export class SystemHealthModule {}
