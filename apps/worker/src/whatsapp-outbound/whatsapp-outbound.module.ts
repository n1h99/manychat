import { Module } from '@nestjs/common';

import { WhatsAppOutboundProcessorService } from './whatsapp-outbound-processor.service';
import { WhatsAppOutboundRecoveryService } from './whatsapp-outbound-recovery.service';

@Module({
  exports: [WhatsAppOutboundProcessorService, WhatsAppOutboundRecoveryService],
  providers: [WhatsAppOutboundProcessorService, WhatsAppOutboundRecoveryService],
})
export class WhatsAppOutboundModule {}
