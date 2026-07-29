import { Module } from '@nestjs/common';
import { CrmOutboxService } from './crm-outbox.service';
import { CRM_CLIENT } from './crm.tokens';
import { ProjectCrmClient } from './project-crm.client';

@Module({
  providers: [{ provide: CRM_CLIENT, useClass: ProjectCrmClient }, CrmOutboxService],
})
export class CrmModule {}
