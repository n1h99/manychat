import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

import { ApiExceptionFilter } from './api-exception.filter';

export function configureApiApplication(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}
