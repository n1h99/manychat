import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AutomationHttpService } from './automation-http.service';

const actor = {
  email: 'admin@example.test',
  globalPermissions: [],
  globalRoleNames: [],
  userId: 'user-a',
};

describe('AutomationHttpService secrets', () => {
  it('stores an encrypted value and only returns safe secret metadata', async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({
      createdAt: new Date('2026-08-02T00:00:00.000Z'),
      id: data.id,
      name: data.name,
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    }));
    const audit = { record: vi.fn() };
    const service = new AutomationHttpService(
      audit as never,
      { get: vi.fn().mockReturnValue(Buffer.alloc(32, 7).toString('base64')) } as never,
      { client: { automationSecret: { create } } } as never,
    );

    const result = await service.createSecret(
      'project-a',
      { name: '  CRM token  ', value: 'plain-secret' },
      actor,
      { correlationId: 'correlation-a' },
    );

    expect(result).not.toHaveProperty('value');
    expect(result).not.toHaveProperty('valueEncrypted');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'CRM token',
          normalizedName: 'crm token',
          valueEncrypted: expect.objectContaining({ algorithm: 'aes-256-gcm' }),
        }),
        select: { createdAt: true, id: true, name: true, updatedAt: true },
      }),
    );
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('plain-secret');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ afterSafeJson: { name: 'CRM token' } }),
    );
  });

  it('rejects a blank secret name after normalization', async () => {
    const service = new AutomationHttpService(
      { record: vi.fn() } as never,
      { get: vi.fn().mockReturnValue(Buffer.alloc(32, 7).toString('base64')) } as never,
      { client: {} } as never,
    );

    await expect(
      service.createSecret('project-a', { name: '   ', value: 'secret' }, actor, {
        correlationId: 'correlation-a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a safe error and audit record for a blocked test target', async () => {
    const audit = { record: vi.fn() };
    const service = new AutomationHttpService(
      audit as never,
      { get: vi.fn().mockReturnValue(Buffer.alloc(32, 7).toString('base64')) } as never,
      { client: {} } as never,
    );

    await expect(
      service.testRequest(
        'project-a',
        { config: { method: 'GET', url: 'https://127.0.0.1/private' } },
        actor,
        { correlationId: 'correlation-a' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'automation.http.test_failed',
        afterSafeJson: {
          errorCode: 'external_http_target_forbidden',
          outcome: 'PERMANENT_FAILURE',
        },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('127.0.0.1');
  });
});
