import { Module } from '@nestjs/common';

import { CrmMockOutboxService } from './crm-mock-outbox.service';

@Module({ providers: [CrmMockOutboxService] })
export class CrmModule {}
