import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  controllers: [AutomationController],
  imports: [AccessModule, AuditModule, JwtModule.register({})],
  providers: [AutomationService],
})
export class AutomationModule {}
