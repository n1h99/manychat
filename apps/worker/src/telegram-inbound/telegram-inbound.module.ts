import { Module } from '@nestjs/common';

import { TelegramInboundProcessorService } from './telegram-inbound-processor.service';

@Module({
  exports: [TelegramInboundProcessorService],
  providers: [TelegramInboundProcessorService],
})
export class TelegramInboundModule {}
