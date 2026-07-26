import { describe, expect, it } from 'vitest';

import { MockCrmClient } from './index';

const context = {
  correlationId: 'correlation-a',
  crmProjectId: 'mock-project-a',
  idempotencyKey: 'operation-a',
  projectId: 'project-a',
};

describe('MockCrmClient', () => {
  it('is deterministic and idempotent by operation key', async () => {
    const client = new MockCrmClient();
    const input = { contactId: 'contact-a', displayName: 'Test', fields: {} };
    await expect(client.createOrUpdateLead(context, input)).resolves.toEqual(
      await client.createOrUpdateLead(context, input),
    );
  });

  it('exposes scripted safe failure classes without a provider contract', async () => {
    const client = new MockCrmClient(() => 'RETRYABLE_FAILURE');
    await expect(
      client.createOrUpdateLead(context, {
        contactId: 'contact-a',
        displayName: 'Test',
        fields: {},
      }),
    ).rejects.toMatchObject({ outcome: 'RETRYABLE_FAILURE' });
  });
});
