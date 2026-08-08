import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { rootEnvironmentFilePath, validateWorkerEnvironment } from '@omnicus/config/server';

import { DatabaseModule } from '../database/database.module';
import { ContactMergeBackfillService } from './contact-merge-backfill.service';

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
      validate: validateWorkerEnvironment,
    }),
    DatabaseModule,
  ],
  providers: [ContactMergeBackfillService],
})
export class ContactMergeBackfillModule {}
