import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [TemplatesController],
  imports: [AccessModule, AuditModule, DatabaseModule, JwtModule.register({})],
  providers: [TemplatesService],
})
export class TemplatesModule {}
