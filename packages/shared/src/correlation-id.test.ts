import { describe, expect, it } from 'vitest';

import { createCorrelationId, isCorrelationId } from './correlation-id';

describe('correlation ids', () => {
  it('preserves a safe caller-provided value', () => {
    expect(createCorrelationId('request-123')).toBe('request-123');
  });

  it('replaces an unsafe value', () => {
    const generated = createCorrelationId('unsafe value');

    expect(generated).not.toBe('unsafe value');
    expect(isCorrelationId(generated)).toBe(true);
  });
});
