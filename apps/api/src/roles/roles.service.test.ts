import { describe, expect, it, vi } from 'vitest';

import { RolesService } from './roles.service';

describe('RolesService', () => {
  it('keeps built-in global roles immutable', async () => {
    const service = new RolesService(
      {} as never,
      {
        client: {
          globalRole: {
            findUnique: vi.fn().mockResolvedValue({ id: 'role-a', system: true }),
          },
        },
      } as never,
    );

    await expect(
      service.update(
        'role-a',
        { name: 'Changed' },
        { email: 'admin@example.test', userId: 'user-a' } as never,
        { correlationId: 'correlation-a' } as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'SYSTEM_ROLE_IMMUTABLE' },
    });
  });
});
