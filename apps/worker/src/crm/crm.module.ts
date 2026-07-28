import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnvironment } from '@omnicus/config/server';
import { CrmClientError, HttpCrmClient, type CrmClient } from '@omnicus/crm-core';

import { CrmOutboxService } from './crm-outbox.service';
import { CRM_CLIENT } from './crm.tokens';

const disabledClient: CrmClient = {
  createOrUpdateLead: async () => {
    throw new CrmClientError('PERMANENT_FAILURE', 'crm_integration_disabled');
  },
  forwardInboundMessage: async () => {
    throw new CrmClientError('PERMANENT_FAILURE', 'crm_integration_disabled');
  },
  reconcile: async () => ({ status: 'NOT_FOUND' }),
};

@Module({
  providers: [
    {
      inject: [ConfigService],
      provide: CRM_CLIENT,
      useFactory: (config: ConfigService<WorkerEnvironment, true>): CrmClient => {
        if (!config.get('CRM_INTEGRATION_ENABLED', { infer: true })) return disabledClient;
        return new HttpCrmClient({
          authToken: config.get('CRM_AUTH_TOKEN', { infer: true })!,
          baseUrl: config.get('CRM_BASE_URL', { infer: true })!,
          timeoutMs: config.get('CRM_REQUEST_TIMEOUT_MS', { infer: true }),
        });
      },
    },
    CrmOutboxService,
  ],
})
export class CrmModule {}
