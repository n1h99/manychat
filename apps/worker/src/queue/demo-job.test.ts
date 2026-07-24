import { describe, expect, it } from 'vitest';

import { executeDemoJob } from './demo-job';

describe('executeDemoJob', () => {
  it('returns an infrastructure-only health result', () => {
    const result = executeDemoJob({
      requestedAt: '2026-07-24T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      requestedAt: '2026-07-24T00:00:00.000Z',
      status: 'ok',
    });
  });
});
