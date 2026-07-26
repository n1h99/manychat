import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { rootEnvironmentFilePath, validateApiEnvironment } from '@omnicus/config/server';

import { CorrelationIdMiddleware } from './platform/correlation-id.middleware';
import { HealthModule } from './health/health.module';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { ProjectsModule } from './projects/projects.module';
import { UsersModule } from './users/users.module';
import { ContactsModule } from './contacts/contacts.module';
import { TelegramWebhookModule } from './telegram-webhook/telegram-webhook.module';
import { ChannelsModule } from './channels/channels.module';
import { AutomationModule } from './automation/automation.module';
import { CrmModule } from './crm/crm.module';

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
    DatabaseModule,
    HealthModule,
    AuditModule,
    AccessModule,
    AuthModule,
    ProjectsModule,
    UsersModule,
    ContactsModule,
    TelegramWebhookModule,
    ChannelsModule,
    AutomationModule,
    CrmModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*path}');
  }
}
