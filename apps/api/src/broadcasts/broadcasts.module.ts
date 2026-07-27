import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { ChannelsModule } from '../channels/channels.module';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsService } from './broadcasts.service';

@Module({
  controllers: [BroadcastsController],
  exports: [BroadcastsService],
  imports: [AccessModule, AuditModule, ChannelsModule, JwtModule.register({})],
  providers: [BroadcastsService],
})
export class BroadcastsModule {}
