import { describe, expect, it, vi } from 'vitest';

import { UsersService } from './users.service';

const actor = {
  email: 'admin@example.test',
  globalPermissions: ['users:manage'],
  globalRoleNames: ['super-admin'],
  userId: 'admin-user',
};

const existingUser = {
  city: null,
  country: null,
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  email: 'user@example.test',
  firstName: 'Existing',
  id: 'user-a',
  lastName: 'User',
  region: null,
  status: 'ACTIVE',
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
};

describe('UsersService account profiles', () => {
  it('normalizes empty location fields without changing access assignments', async () => {
    const update = vi.fn().mockResolvedValue({
      ...existingUser,
      city: 'Baku',
      country: 'Azerbaijan',
      region: null,
    });
    const transaction = {
      session: { updateMany: vi.fn() },
      user: { update },
    };
    const audit = { record: vi.fn() };
    const database = {
      client: {
        $transaction: vi.fn(async (callback) => callback(transaction)),
        user: { findUnique: vi.fn().mockResolvedValue(existingUser) },
      },
    };
    const service = new UsersService(audit as never, {} as never, database as never);

    await service.update(
      'user-a',
      { city: ' Baku ', country: ' Azerbaijan ', region: '   ' },
      actor,
      { correlationId: 'correlation-a' },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ city: 'Baku', country: 'Azerbaijan', region: null }),
      }),
    );
    expect(transaction.session.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        afterSafeJson: expect.objectContaining({ city: 'Baku', country: 'Azerbaijan' }),
      }),
    );
  });

  it('hashes a new password, revokes sessions and never audits the secret', async () => {
    const update = vi.fn().mockImplementation(({ data }) => ({ ...existingUser, ...data }));
    const transaction = {
      session: { updateMany: vi.fn() },
      user: { update },
    };
    const audit = { record: vi.fn() };
    const database = {
      client: {
        $transaction: vi.fn(async (callback) => callback(transaction)),
        user: { findUnique: vi.fn().mockResolvedValue(existingUser) },
      },
    };
    const service = new UsersService(audit as never, {} as never, database as never);
    const newPassword = 'new-secure-password';

    await service.update('user-a', { newPassword }, actor, { correlationId: 'correlation-b' });

    const updateData = update.mock.calls[0]?.[0].data as { passwordHash: string };
    expect(updateData.passwordHash).toMatch(/^\$argon2id\$/);
    expect(updateData.passwordHash).not.toContain(newPassword);
    expect(transaction.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE', userId: 'user-a' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.password.changed' }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(newPassword);
  });

  it('preserves the current session during a self-service password change', async () => {
    const update = vi.fn().mockImplementation(({ data }) => ({ ...existingUser, ...data }));
    const transaction = {
      session: { updateMany: vi.fn() },
      user: { update },
    };
    const database = {
      client: {
        $transaction: vi.fn(async (callback) => callback(transaction)),
        user: { findUnique: vi.fn().mockResolvedValue(existingUser) },
      },
    };
    const service = new UsersService({ record: vi.fn() } as never, {} as never, database as never);

    await service.update(
      'user-a',
      { newPassword: 'another-secure-password' },
      actor,
      { correlationId: 'correlation-c' },
      'current-session',
    );

    expect(transaction.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { not: 'current-session' }, status: 'ACTIVE', userId: 'user-a' },
      }),
    );
  });

  it('activates a disabled user and audits activation', async () => {
    const update = vi.fn().mockImplementation(({ data }) => ({ ...existingUser, ...data }));
    const transaction = {
      user: { update },
    };
    const audit = { record: vi.fn() };
    const database = {
      client: {
        $transaction: vi.fn(async (callback) => callback(transaction)),
        user: {
          findUnique: vi.fn().mockResolvedValue({
            ...existingUser,
            status: 'DISABLED',
          }),
        },
      },
    };
    const service = new UsersService(audit as never, {} as never, database as never);

    await service.activate('user-a', actor, { correlationId: 'correlation-activate' });

    expect(update).toHaveBeenCalledWith({ data: { status: 'ACTIVE' }, where: { id: 'user-a' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.activated',
        beforeSafeJson: { status: 'DISABLED' },
        afterSafeJson: { status: 'ACTIVE' },
      }),
    );
  });

  it('hard deletes a user account and all related sessions', async () => {
    const deleteMany = vi.fn();
    const userDelete = vi.fn().mockResolvedValue(existingUser);
    const transaction = {
      session: { deleteMany },
      user: { delete: userDelete },
    };
    const audit = { record: vi.fn() };
    const database = {
      client: {
        $transaction: vi.fn(async (callback) => callback(transaction)),
        user: { findUnique: vi.fn().mockResolvedValue(existingUser) },
      },
    };
    const service = new UsersService(audit as never, {} as never, database as never);

    await service.delete('user-a', actor, { correlationId: 'correlation-delete' });

    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-a' } });
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 'user-a' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.deleted',
        beforeSafeJson: { status: 'ACTIVE' },
      }),
    );
  });
});
