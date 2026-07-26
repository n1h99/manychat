import { Module } from '@nestjs/common';

import { TelegramInboundProcessorService } from './telegram-inbound-processor.service';
import { TelegramInboundRecoveryService } from './telegram-inbound-recovery.service';

@Module({
  exports: [TelegramInboundProcessorService, TelegramInboundRecoveryService],
  providers: [TelegramInboundProcessorService, TelegramInboundRecoveryService],
})
export class TelegramInboundModule {}
