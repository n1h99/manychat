import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CrmService } from './crm.service';

const actor = {
  email: 'admin@example.test',
  globalPermissions: [],
  globalRoleNames: [],
  userId: 'user-a',
};
const context = { correlationId: 'correlation-a' };

function operation(status: 'FAILED' | 'PENDING' | 'UNKNOWN') {
  return {
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    id: 'operation-a',
    outbox: { attempts: 3, lastError: 'safe_error', status },
    outboxRecordId: 'outbox-a',
    resultSafe: null,
    type: 'CREATE_OR_UPDATE_LEAD' as const,
    updatedAt: new Date('2026-07-27T00:00:00.000Z'),
  };
}

describe('CrmService manual retry', () => {
  it('requires explicit confirmation before retrying unknown delivery', async () => {
    const tx = { crmOperation: { findUnique: vi.fn().mockResolvedValue(operation('UNKNOWN')) } };
    const database = {
      client: { $transaction: (callback: (input: typeof tx) => unknown) => callback(tx) },
    };
    const service = new CrmService({ record: vi.fn() } as never, database as never);

    await expect(
      service.retryOperation('project-a', 'operation-a', {}, actor, context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not retry an operation from another project', async () => {
    const tx = { crmOperation: { findUnique: vi.fn().mockResolvedValue(null) } };
    const database = {
      client: { $transaction: (callback: (input: typeof tx) => unknown) => callback(tx) },
    };
    const service = new CrmService({ record: vi.fn() } as never, database as never);

    await expect(
      service.retryOperation(
        'project-a',
        'operation-b',
        { confirmUnknownDelivery: true },
        actor,
        context,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requeues a failed operation and records only safe audit context', async () => {
    const failed = operation('FAILED');
    const pending = {
      ...operation('PENDING'),
      outbox: { attempts: 0, lastError: null, status: 'PENDING' as const },
    };
    const tx = {
      crmOperation: {
        findUnique: vi.fn().mockResolvedValue(failed),
        findUniqueOrThrow: vi.fn().mockResolvedValue(pending),
      },
      outboxRecord: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const audit = { record: vi.fn() };
    const database = {
      client: { $transaction: (callback: (input: typeof tx) => unknown) => callback(tx) },
    };
    const service = new CrmService(audit as never, database as never);

    await expect(
      service.retryOperation('project-a', 'operation-a', {}, actor, context),
    ).resolves.toMatchObject({ id: 'operation-a', status: 'PENDING' });
    expect(tx.outboxRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 'project-a', status: 'FAILED' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'crm.operation.manual_retry_requested',
        afterSafeJson: expect.objectContaining({ confirmedUnknownDelivery: false }),
      }),
    );
  });
});
