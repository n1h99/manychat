import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  exports: [MediaService],
  imports: [AccessModule, AuditModule, DatabaseModule, JwtModule.register({})],
  providers: [MediaService],
})
export class MediaModule {}
