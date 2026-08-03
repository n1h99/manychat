import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { ChannelsModule } from '../channels/channels.module';
import { TelegramWebhookModule } from '../telegram-webhook/telegram-webhook.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  controllers: [OperationsController],
  imports: [
    AccessModule,
    AuditModule,
    ChannelsModule,
    JwtModule.register({}),
    TelegramWebhookModule,
  ],
  providers: [OperationsService],
})
export class OperationsModule {}
