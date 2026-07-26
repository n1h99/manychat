import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessService } from './access.service';
import { PermissionGuard } from './permission.guard';

@Module({
  exports: [AccessService, JwtAuthGuard, PermissionGuard],
  imports: [JwtModule.register({})],
  providers: [AccessService, JwtAuthGuard, PermissionGuard],
})
export class AccessModule {}
