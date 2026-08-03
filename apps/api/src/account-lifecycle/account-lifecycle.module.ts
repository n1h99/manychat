import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import {
  GlobalInvitationsController,
  ProjectInvitationsController,
  PublicAccountLifecycleController,
} from './account-lifecycle.controller';
import { AccountLifecycleService } from './account-lifecycle.service';

@Module({
  controllers: [
    GlobalInvitationsController,
    ProjectInvitationsController,
    PublicAccountLifecycleController,
  ],
  imports: [AccessModule, AuditModule, JwtModule.register({})],
  providers: [AccountLifecycleService],
})
export class AccountLifecycleModule {}
