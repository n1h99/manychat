import { describe, expect, it } from 'vitest';

import { telegramInboundJobIdFor } from './index';

describe('telegramInboundJobIdFor', () => {
  it('creates a stable BullMQ-safe ID for each inbox record', () => {
    const first = telegramInboundJobIdFor('inbox-a');

    expect(telegramInboundJobIdFor('inbox-a')).toBe(first);
    expect(first).not.toContain(':');
    expect(telegramInboundJobIdFor('inbox-b')).not.toBe(first);
  });
});
