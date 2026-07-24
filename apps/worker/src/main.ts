import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { WorkerEnvironment } from '@omnicus/config/server';
import type { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module';

const logger = new ConsoleLogger({
  json: true,
  prefix: 'worker',
});

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  );
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  next();
}

function logFatalBootstrapError(error: unknown): void {
  logger.error({
    error:
      error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : { value: String(error) },
    message: 'Fatal worker bootstrap failure',
    service: 'worker',
  });
}

async function bootstrap(): Promise<void> {
  let app: NestExpressApplication | undefined;

  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
    const config = app.get(ConfigService<WorkerEnvironment, true>);

    app.use(securityHeaders);
    app.enableShutdownHooks();
    const port =
      config.get('PORT', { infer: true }) ?? config.get('WORKER_PORT', { infer: true }) ?? 3001;
    const host = config.get('WORKER_HOST', { infer: true });
    await app.listen(port, host);
    logger.log({
      host,
      message: 'Worker health server started',
      port,
      service: 'worker',
    });
  } catch (error) {
    logFatalBootstrapError(error);
    if (app) {
      try {
        await app.close();
      } catch (closeError) {
        logger.error({
          error:
            closeError instanceof Error
              ? {
                  message: closeError.message,
                  name: closeError.name,
                  stack: closeError.stack,
                }
              : { value: String(closeError) },
          message: 'Worker cleanup after bootstrap failure failed',
          service: 'worker',
        });
      }
    }
    process.exitCode = 1;
  }
}

void bootstrap();
