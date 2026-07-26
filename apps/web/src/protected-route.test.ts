import { describe, expect, it } from 'vitest';

import { unauthenticatedRedirect } from './protected-route';

describe('protected routes', () => {
  it('redirects only unauthenticated users to login', () => {
    expect(unauthenticatedRedirect('/projects/project-a/channels', false)).toBe('/login');
    expect(unauthenticatedRedirect('/projects/project-a/channels', true)).toBeUndefined();
  });
});
