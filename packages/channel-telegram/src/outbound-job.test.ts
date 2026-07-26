import { describe, expect, it } from 'vitest';
import { telegramOutboundJobIdFor } from './index';

describe('telegram outbound BullMQ job IDs', () => {
  it('is stable, unique by outbox record, and BullMQ-safe', () => {
    expect(telegramOutboundJobIdFor('outbox-a')).toBe(telegramOutboundJobIdFor('outbox-a'));
    expect(telegramOutboundJobIdFor('outbox-a')).not.toContain(':');
    expect(telegramOutboundJobIdFor('outbox-a')).not.toBe(telegramOutboundJobIdFor('outbox-b'));
  });
});
