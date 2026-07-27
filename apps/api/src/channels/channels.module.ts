import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { TelegramOutboundQueueService } from './telegram-outbound-queue.service';
@Module({
  controllers: [ChannelsController],
  imports: [AccessModule, AuditModule, DatabaseModule, JwtModule.register({})],
  providers: [ChannelsService, TelegramOutboundQueueService],
  exports: [TelegramOutboundQueueService],
})
export class ChannelsModule {}
