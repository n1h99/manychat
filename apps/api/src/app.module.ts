import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateApiEnvironment } from '@omnicus/config';

import { CorrelationIdMiddleware } from './platform/correlation-id.middleware';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: validateApiEnvironment,
    }),
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*path}');
  }
}
