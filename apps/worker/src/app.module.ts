import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateWorkerEnvironment } from '@omnicus/config';

import { DemoQueueModule } from './queue/demo-queue.module';
import { WorkerHealthController } from './worker-health.controller';

@Module({
  controllers: [WorkerHealthController],
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: validateWorkerEnvironment,
    }),
    DemoQueueModule,
  ],
})
export class AppModule {}
