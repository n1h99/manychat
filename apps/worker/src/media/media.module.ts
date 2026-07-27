import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MediaRetentionService } from './media-retention.service';

@Module({
  imports: [DatabaseModule],
  providers: [MediaRetentionService],
})
export class MediaModule {}
