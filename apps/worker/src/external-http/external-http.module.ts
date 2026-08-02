import { Module } from '@nestjs/common';

import { AutomationModule } from '../automation/automation.module';
import { ExternalHttpOutboxService } from './external-http-outbox.service';

@Module({
  imports: [AutomationModule],
  providers: [ExternalHttpOutboxService],
})
export class ExternalHttpModule {}
