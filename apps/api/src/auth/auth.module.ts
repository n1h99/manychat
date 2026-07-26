import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginRateLimitService } from './login-rate-limit.service';

@Module({
  controllers: [AuthController],
  exports: [AuthService],
  imports: [AccessModule, AuditModule, JwtModule.register({})],
  providers: [AuthService, LoginRateLimitService],
})
export class AuthModule {}
