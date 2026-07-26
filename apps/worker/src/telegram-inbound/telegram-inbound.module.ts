import { Module } from '@nestjs/common';

import { AutomationModule } from '../automation/automation.module';
import { TelegramInboundProcessorService } from './telegram-inbound-processor.service';
import { TelegramInboundRecoveryService } from './telegram-inbound-recovery.service';

@Module({
  exports: [TelegramInboundProcessorService, TelegramInboundRecoveryService],
  imports: [AutomationModule],
  providers: [TelegramInboundProcessorService, TelegramInboundRecoveryService],
})
export class TelegramInboundModule {}
