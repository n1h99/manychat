import { Module } from '@nestjs/common';

import { AutomationRuntimeService } from './automation-runtime.service';
import { AutomationContinuationService } from './automation-continuation.service';

@Module({
  exports: [AutomationRuntimeService, AutomationContinuationService],
  providers: [AutomationRuntimeService, AutomationContinuationService],
})
export class AutomationModule {}
