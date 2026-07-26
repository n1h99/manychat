import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { rootEnvironmentFilePath, validateWorkerEnvironment } from '@omnicus/config/server';

import { DemoQueueModule } from './queue/demo-queue.module';
import { DatabaseModule } from './database/database.module';
import { TelegramInboundModule } from './telegram-inbound/telegram-inbound.module';
import { TelegramOutboundModule } from './telegram-outbound/telegram-outbound.module';
import { WorkerHealthController } from './worker-health.controller';

const rootEnvFile =
  process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging'
    ? undefined
    : rootEnvironmentFilePath();

@Module({
  controllers: [WorkerHealthController],
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: rootEnvFile ? [rootEnvFile] : [],
      isGlobal: true,
      validate: validateWorkerEnvironment,
    }),
    DatabaseModule,
    DemoQueueModule,
    TelegramInboundModule,
    TelegramOutboundModule,
  ],
})
export class AppModule {}
