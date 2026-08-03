import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { AutomationActivityController } from './automation-activity.controller';
import { AutomationActivityService } from './automation-activity.service';
import { AutomationController } from './automation.controller';
import { AutomationHttpController } from './automation-http.controller';
import { AutomationHttpService } from './automation-http.service';
import { AutomationService } from './automation.service';

@Module({
  controllers: [AutomationController, AutomationHttpController, AutomationActivityController],
  imports: [AccessModule, AuditModule, JwtModule.register({})],
  providers: [AutomationService, AutomationHttpService, AutomationActivityService],
})
export class AutomationModule {}
