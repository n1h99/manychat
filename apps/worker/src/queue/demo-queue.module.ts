import { Module } from '@nestjs/common';

import { DemoQueueService } from './demo-queue.service';

@Module({
  exports: [DemoQueueService],
  providers: [DemoQueueService],
})
export class DemoQueueModule {}
