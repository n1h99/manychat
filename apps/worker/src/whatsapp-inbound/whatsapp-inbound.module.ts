import { Module } from '@nestjs/common';

import { AutomationModule } from '../automation/automation.module';
import { WhatsAppInboundProcessorService } from './whatsapp-inbound-processor.service';
import { WhatsAppInboundRecoveryService } from './whatsapp-inbound-recovery.service';

@Module({
  exports: [WhatsAppInboundProcessorService, WhatsAppInboundRecoveryService],
  imports: [AutomationModule],
  providers: [WhatsAppInboundProcessorService, WhatsAppInboundRecoveryService],
})
export class WhatsAppInboundModule {}
