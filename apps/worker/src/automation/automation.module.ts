import { Module } from '@nestjs/common';

import { AutomationRuntimeService } from './automation-runtime.service';

@Module({
  exports: [AutomationRuntimeService],
  providers: [AutomationRuntimeService],
})
export class AutomationModule {}
