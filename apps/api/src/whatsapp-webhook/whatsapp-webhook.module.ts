import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { WhatsAppInboundQueueService } from './whatsapp-inbound-queue.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Module({
  controllers: [WhatsAppWebhookController],
  exports: [WhatsAppInboundQueueService],
  imports: [AuditModule, DatabaseModule],
  providers: [WhatsAppInboundQueueService, WhatsAppWebhookService],
})
export class WhatsAppWebhookModule {}
