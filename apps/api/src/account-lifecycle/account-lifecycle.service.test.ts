import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { AccountLifecycleService } from './account-lifecycle.service';

describe('AccountLifecycleService', () => {
  it('deduplicates repeated password-reset requests without changing the public response', async () => {
    const audit = { record: vi.fn() };
    const service = new AccountLifecycleService(
      audit as never,
      {} as never,
      {
        client: {
          auditLog: { findFirst: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
          user: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ id: 'user-a', status: 'ACTIVE', email: 'user@example.test' }),
          },
        },
      } as never,
    );

    await expect(
      service.requestPasswordReset('user@example.test', { correlationId: 'correlation-a' }),
    ).resolves.toEqual({ accepted: true });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not disclose whether the invited email already has an account', async () => {
    const service = new AccountLifecycleService(
      {} as never,
      {} as never,
      {
        client: {
          globalUserInviteToken: {
            findUnique: vi.fn().mockResolvedValue({
              acceptedAt: null,
              emailSnapshot: 'invitee@example.test',
              expiresAt: new Date(Date.now() + 60_000),
              globalRole: { name: 'Operator' },
              revokedAt: null,
            }),
          },
        },
      } as never,
    );

    const preview = await service.previewInvitation({ token: 'a'.repeat(48) });
    expect(preview).toMatchObject({ email: 'in***@example.test', scope: 'GLOBAL' });
    expect(preview).not.toHaveProperty('accountExists');
  });

  it('stores only the invitation token hash and returns the raw link once', async () => {
    const createInvite = vi.fn(async ({ data }) => ({
      ...data,
      id: 'invite-a',
    }));
    const transaction = {
      globalActiveInviteReservation: {
        create: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      globalUserInviteToken: { create: createInvite },
    };
    const audit = { record: vi.fn() };
    const service = new AccountLifecycleService(
      audit as never,
      { get: vi.fn().mockReturnValue('https://app.example.test') } as never,
      {
        client: {
          $transaction: vi.fn(async (callback) => callback(transaction)),
          globalRole: { findUnique: vi.fn().mockResolvedValue({ id: 'role-a' }) },
        },
      } as never,
    );

    const result = await service.createGlobalInvitation(
      { email: 'Invitee@Example.test', expiresInHours: 24, globalRoleId: 'role-a' },
      { email: 'admin@example.test', userId: 'user-a' } as never,
      { correlationId: 'correlation-a' } as never,
    );

    const rawToken = decodeURIComponent(result.invitationUrl.split('token=')[1]!);
    const stored = createInvite.mock.calls[0]![0].data;
    expect(result.invitationUrl).toMatch(/^https:\/\/app\.example\.test\/accept-invitation#token=/);
    expect(stored.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(stored)).not.toContain(rawToken);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'global.invitation.created' }),
    );
  });
});
