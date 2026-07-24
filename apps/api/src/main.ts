import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { parseCorsOrigins, type ApiEnvironment } from '@omnicus/config';

import { AppModule } from './app.module';
import { configureApiApplication } from './platform/configure-api-application';

async function bootstrap(): Promise<void> {
  const logger = new ConsoleLogger({
    json: true,
    prefix: 'api',
  });
  const app = await NestFactory.create(AppModule, { logger });
  const config = app.get(ConfigService<ApiEnvironment, true>);

  configureApiApplication(app);
  app.enableCors({
    credentials: true,
    origin: parseCorsOrigins(config.get('CORS_ALLOWED_ORIGINS', { infer: true })),
  });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Omnicus API')
    .setDescription('Stage 0 infrastructure API')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port =
    config.get('APP_ENV', { infer: true }) === 'development'
      ? config.get('API_PORT', { infer: true })
      : (config.get('PORT', { infer: true }) ?? config.get('API_PORT', { infer: true }));
  await app.listen(port ?? 3000, config.get('API_HOST', { infer: true }));
}

void bootstrap();
