import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { WorkerEnvironment } from '@omnicus/config';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new ConsoleLogger({
    json: true,
    prefix: 'worker',
  });
  const app = await NestFactory.create(AppModule, { logger });
  const config = app.get(ConfigService<WorkerEnvironment, true>);

  app.enableShutdownHooks();
  const port =
    config.get('APP_ENV', { infer: true }) === 'development'
      ? config.get('WORKER_PORT', { infer: true })
      : (config.get('PORT', { infer: true }) ?? config.get('WORKER_PORT', { infer: true }));
  await app.listen(port ?? 3001, config.get('WORKER_HOST', { infer: true }));
}

void bootstrap();
