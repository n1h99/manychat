import { describe, expect, it } from 'vitest';

import { navigationItems } from './navigation';

describe('application shell navigation', () => {
  it('contains unique Stage 1 navigation routes', () => {
    const paths = navigationItems.map((item) => item.path);

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('/projects');
    expect(paths).toContain('/automation-activity');
    expect(paths).toContain('/users');
    expect(navigationItems.findIndex((item) => item.key === 'automation-activity')).toBe(
      navigationItems.findIndex((item) => item.key === 'projects') + 1,
    );
  });
});
