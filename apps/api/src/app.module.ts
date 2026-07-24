import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { rootEnvironmentFilePath, validateApiEnvironment } from '@omnicus/config/server';

import { CorrelationIdMiddleware } from './platform/correlation-id.middleware';
import { HealthModule } from './health/health.module';

const rootEnvFile =
  process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging'
    ? undefined
    : rootEnvironmentFilePath();

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: rootEnvFile ? [rootEnvFile] : [],
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
