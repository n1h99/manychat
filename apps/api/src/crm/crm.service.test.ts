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
const testSecretsKey = Buffer.alloc(32, 3).toString('base64');
const config = {
  get: vi.fn((key: string) => {
    if (key === 'CHANNEL_SECRETS_KEY') return testSecretsKey;
    if (key === 'APP_ENV') return 'test';
    if (key === 'API_PUBLIC_URL') return 'http://localhost:3000';
    return undefined;
  }),
};

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
    const service = new CrmService(
      { record: vi.fn() } as never,
      database as never,
      config as never,
    );

    await expect(
      service.retryOperation('project-a', 'operation-a', {}, actor, context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not retry an operation from another project', async () => {
    const tx = { crmOperation: { findUnique: vi.fn().mockResolvedValue(null) } };
    const database = {
      client: { $transaction: (callback: (input: typeof tx) => unknown) => callback(tx) },
    };
    const service = new CrmService(
      { record: vi.fn() } as never,
      database as never,
      config as never,
    );

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
    const service = new CrmService(audit as never, database as never, config as never);

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

describe('CrmService connection safety', () => {
  it('never returns token hashes or encrypted credentials from project config', async () => {
    const database = {
      client: {
        crmProjectConfig: {
          findUnique: vi.fn().mockResolvedValue({
            baseUrl: 'https://crm.example',
            capabilities: {},
            createdAt: new Date(),
            credentialsEncrypted: { ciphertext: 'secret-ciphertext' },
            crmProjectId: 'crm-a',
            defaultPipeline: null,
            defaultStage: null,
            enabled: true,
            fieldMapping: {},
            id: 'config-a',
            inboundTokenHash: 'secret-hash',
            lastErrorAt: null,
            lastTestedAt: null,
            pairingCodeHash: 'pairing-hash',
            projectId: 'project-a',
            provider: 'CYBER_PULSE',
            status: 'ACTIVE',
            updatedAt: new Date(),
          }),
        },
      },
    };
    const service = new CrmService(
      { record: vi.fn() } as never,
      database as never,
      config as never,
    );

    const result = await service.getConfig('project-a');
    expect(result).toMatchObject({ paired: true, status: 'ACTIVE' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('rejects a pairing code bound to a different CRM tenant', async () => {
    const database = {
      client: {
        crmProjectConfig: {
          findUnique: vi.fn().mockResolvedValue({
            crmProjectId: 'crm-a',
            pairingExpiresAt: new Date(Date.now() + 60_000),
            project: { status: 'ACTIVE' },
          }),
        },
      },
    };
    const service = new CrmService(
      { record: vi.fn() } as never,
      database as never,
      config as never,
    );

    await expect(
      service.completePairing({
        crmBaseUrl: 'https://crm.example',
        crmInboundAuthToken: 'crm-token-that-is-at-least-thirty-two-characters',
        crmProjectId: 'crm-b',
        pairingCode: 'omx_pairing-code-that-is-long-enough',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('consumes a pairing once and persists only encrypted or hashed credentials', async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      crmProjectConfig: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const database = {
      client: {
        $transaction: (callback: (input: typeof transaction) => unknown) => callback(transaction),
        crmProjectConfig: {
          findUnique: vi.fn().mockResolvedValue({
            crmProjectId: 'crm-a',
            id: 'config-a',
            pairingExpiresAt: new Date(Date.now() + 60_000),
            project: { name: 'Project A', slug: 'project-a', status: 'ACTIVE' },
            projectId: 'project-a',
            provider: 'CYBER_PULSE',
          }),
        },
      },
    };
    const service = new CrmService(
      { record: vi.fn() } as never,
      database as never,
      config as never,
    );
    const crmToken = 'crm-token-that-is-at-least-thirty-two-characters';

    const result = await service.completePairing({
      capabilities: { mediaV2: true },
      crmBaseUrl: 'https://crm.example',
      crmInboundAuthToken: crmToken,
      crmProjectId: 'crm-a',
      pairingCode: 'omx_pairing-code-that-is-long-enough',
    });

    expect(result).toMatchObject({
      crmProjectId: 'crm-a',
      omnicusProjectId: 'project-a',
      status: 'ACTIVE',
    });
    expect(result.omnicusInboundAuthToken).toMatch(/^omnicus_/);
    const update = transaction.crmProjectConfig.updateMany.mock.calls[0]?.[0];
    expect(update.where).toMatchObject({
      id: 'config-a',
      projectId: 'project-a',
    });
    expect(update.data.credentialsEncrypted).toMatchObject({
      algorithm: 'aes-256-gcm',
      version: 1,
    });
    expect(update.data.inboundTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(update)).not.toContain(crmToken);
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'crm.pairing.completed',
          projectId: 'project-a',
        }),
      }),
    );
    expect(JSON.stringify(transaction.auditLog.create.mock.calls)).not.toContain('token');
  });
});
