import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ChannelConnectionService } from './channel-connection.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramInboundQueueService } from './telegram-inbound-queue.service';
import { TelegramWebhookService } from './telegram-webhook.service';

@Module({
  controllers: [TelegramWebhookController],
  exports: [ChannelConnectionService, TelegramInboundQueueService, TelegramWebhookService],
  imports: [AuditModule, DatabaseModule],
  providers: [ChannelConnectionService, TelegramInboundQueueService, TelegramWebhookService],
})
export class TelegramWebhookModule {}
