import { MockCrmClient } from '@omnicus/crm-core';
import { describe, expect, it, vi } from 'vitest';

import { CrmMockOutboxService } from './crm-mock-outbox.service';

function createDatabase() {
  const operation = {
    contact: { customFields: {}, displayName: 'Contact A', id: 'contact-a' },
    contactId: 'contact-a',
    id: 'crm-operation-a',
    normalizedEvent: null,
    normalizedEventId: null,
    project: { crmConfig: { crmProjectId: 'mock-crm-a', enabled: true } },
    projectId: 'project-a',
    type: 'CREATE_OR_UPDATE_LEAD' as const,
  };
  const transaction = {
    contact: { update: vi.fn() },
    crmOperation: { update: vi.fn() },
    outboxRecord: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return {
    client: {
      $transaction: (callback: (input: typeof transaction) => unknown) => callback(transaction),
      crmOperation: { findUnique: vi.fn().mockResolvedValue(operation) },
      outboxRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ createdAt: new Date(), id: 'outbox-a', projectId: 'project-a' }]),
        findUnique: vi.fn().mockResolvedValue({ attempts: 1, maxAttempts: 3 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
    operation,
    transaction,
  };
}

describe('CrmMockOutboxService', () => {
  it('writes a safe CRM result and completes a claimed outbox record', async () => {
    const database = createDatabase();
    const service = new CrmMockOutboxService(database as never);

    await service.scanOnce(new Date());

    expect(database.transaction.crmOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { resultSafe: expect.objectContaining({ providerReference: expect.any(String) }) },
      }),
    );
    expect(database.transaction.outboxRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    );
  });

  it('records a safe retry state without propagating a mock provider error', async () => {
    const database = createDatabase();
    const service = new CrmMockOutboxService(database as never);
    Object.defineProperty(service, 'client', {
      value: new MockCrmClient(() => 'RETRYABLE_FAILURE'),
    });

    await service.scanOnce(new Date());

    expect(database.client.outboxRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: 'crm_mock_retryable_failure', status: 'RETRY' }),
      }),
    );
  });
});
