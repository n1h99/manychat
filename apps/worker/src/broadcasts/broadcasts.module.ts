import { Module } from '@nestjs/common';

import { BroadcastPreparationService } from './broadcast-preparation.service';

@Module({ providers: [BroadcastPreparationService] })
export class BroadcastsModule {}
