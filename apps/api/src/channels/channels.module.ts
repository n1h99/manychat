import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { TelegramOutboundQueueService } from './telegram-outbound-queue.service';
import { WhatsAppChannelsService } from './whatsapp-channels.service';
import { WhatsAppOutboundQueueService } from './whatsapp-outbound-queue.service';
@Module({
  controllers: [ChannelsController],
  imports: [AccessModule, AuditModule, DatabaseModule, JwtModule.register({})],
  providers: [
    ChannelsService,
    TelegramOutboundQueueService,
    WhatsAppChannelsService,
    WhatsAppOutboundQueueService,
  ],
  exports: [TelegramOutboundQueueService, WhatsAppOutboundQueueService],
})
export class ChannelsModule {}
