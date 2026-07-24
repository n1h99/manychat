import { describe, expect, it } from 'vitest';

import { validateWebEnvironment } from './web';

describe('web environment validation', () => {
  it('uses a local default outside production', () => {
    expect(validateWebEnvironment({}, { production: false }).VITE_API_URL).toBe(
      'http://localhost:3000',
    );
  });

  it('requires VITE_API_URL for production builds', () => {
    expect(() => validateWebEnvironment({}, { production: true })).toThrow();
  });

  it('rejects a non-HTTP API URL', () => {
    expect(() =>
      validateWebEnvironment({ VITE_API_URL: 'file:///tmp/api' }, { production: true }),
    ).toThrow();
  });
});
