import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

import { ApiExceptionFilter } from './api-exception.filter';
import { createSecurityHeadersMiddleware } from './security-headers.middleware';

export interface ApiApplicationOptions {
  swaggerEnabled: boolean;
}

export function configureApiApplication(
  app: INestApplication,
  options: ApiApplicationOptions,
): void {
  app.use(createSecurityHeadersMiddleware(options.swaggerEnabled));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}
