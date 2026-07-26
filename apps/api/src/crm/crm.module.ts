import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { CrmController } from './crm.controller';
import { CrmOperationsController } from './crm-operations.controller';
import { CrmService } from './crm.service';

@Module({
  controllers: [CrmController, CrmOperationsController],
  imports: [AccessModule, AuditModule, JwtModule.register({})],
  providers: [CrmService],
})
export class CrmModule {}
