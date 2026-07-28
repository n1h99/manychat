import { Module } from '@nestjs/common';

import { ChannelsModule } from '../channels/channels.module';
import { CrmIntegrationAuthGuard } from './crm-integration-auth.guard';
import { CrmIntegrationController } from './crm-integration.controller';
import { CrmOutboundService } from './crm-outbound.service';

@Module({
  controllers: [CrmIntegrationController],
  imports: [ChannelsModule],
  providers: [CrmIntegrationAuthGuard, CrmOutboundService],
})
export class CrmIntegrationModule {}
