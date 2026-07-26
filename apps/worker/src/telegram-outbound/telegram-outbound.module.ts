import { Module } from '@nestjs/common';
import { TelegramOutboundProcessorService } from './telegram-outbound-processor.service';
import { TelegramOutboundRecoveryService } from './telegram-outbound-recovery.service';
@Module({ providers: [TelegramOutboundProcessorService, TelegramOutboundRecoveryService] })
export class TelegramOutboundModule {}
