import { describe, expect, it, vi } from 'vitest';

import { MediaController } from './media.controller';

describe('MediaController', () => {
  it('rejects an unknown media kind before calling storage', async () => {
    const upload = vi.fn();
    const controller = new MediaController({ upload } as never);

    await expect(
      controller.upload('project-a', 'VIDEO' as 'PHOTO', undefined, {
        auth: { userId: 'user-a' },
        headers: {},
        ip: '127.0.0.1',
      } as never),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_KIND_INVALID', message: 'Media kind is invalid' },
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
