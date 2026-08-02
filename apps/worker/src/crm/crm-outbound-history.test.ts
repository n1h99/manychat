import { describe, expect, it, vi } from 'vitest';

import { crmOutboundHistorySource, ensureCrmOutboundHistoryIntent } from './crm-outbound-history';

function transaction(metadata: Record<string, unknown>) {
  const outbox = { crmOperation: null, id: 'crm-outbox-a' };
  return {
    crmOperation: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ id: 'crm-operation-a' }),
    },
    crmProjectConfig: {
      findUnique: vi.fn().mockResolvedValue({ enabled: true }),
    },
    message: {
      findUnique: vi.fn().mockResolvedValue({
        contactId: 'contact-a',
        direction: 'OUTBOUND',
        externalMessageId: 'telegram-42',
        metadata,
        status: 'SENT',
      }),
    },
    outboxRecord: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(outbox),
      update: vi.fn().mockResolvedValue({}),
    },
    scenarioExecution: {
      findUnique: vi.fn().mockResolvedValue({
        scenario: { id: 'scenario-a', name: 'Qualification' },
      }),
    },
  };
}

describe('CRM outbound history intent', () => {
  it('creates one stable project-scoped outbox and message operation', async () => {
    const tx = transaction({
      scenarioExecutionId: 'execution-a',
      source: 'automation',
    });

    await expect(
      ensureCrmOutboundHistoryIntent(tx as never, 'project-a', 'message-a'),
    ).resolves.toBe(true);

    expect(tx.outboxRecord.createMany).toHaveBeenCalledWith({
      data: [
        {
          idempotencyKey: 'crm-outbound-history-message-a',
          kind: 'CRM',
          payload: {},
          projectId: 'project-a',
        },
      ],
      skipDuplicates: true,
    });
    expect(tx.crmOperation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          contactId: 'contact-a',
          inputSafe: expect.objectContaining({
            sourceContext: {
              displayName: 'Qualification',
              id: 'scenario-a',
              type: 'scenario',
            },
          }),
          messageId: 'message-a',
          outboxRecordId: 'crm-outbox-a',
          projectId: 'project-a',
          type: 'FORWARD_OUTBOUND_MESSAGE',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('does not echo a CRM-originated outbound message back to CRM', async () => {
    const tx = transaction({ source: 'crm' });

    await expect(
      ensureCrmOutboundHistoryIntent(tx as never, 'project-a', 'message-a'),
    ).resolves.toBe(false);

    expect(tx.outboxRecord.createMany).not.toHaveBeenCalled();
    expect(crmOutboundHistorySource({ source: 'crm' })).toBeUndefined();
  });

  it('classifies broadcasts without relying on mutable message text', () => {
    expect(crmOutboundHistorySource({ broadcastId: 'broadcast-a' })).toBe('BROADCAST');
    expect(crmOutboundHistorySource({ source: 'automation' })).toBe('AUTOMATION');
    expect(crmOutboundHistorySource({})).toBe('SYSTEM');
  });
});
