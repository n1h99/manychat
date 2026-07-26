import { describe, expect, it } from 'vitest';

import {
  classifyTelegramInboundFailure,
  TelegramInboundLeaseConflictError,
  telegramInboundRetryDelayMaximumMilliseconds,
  telegramInboundRetryDelayMilliseconds,
} from './telegram-inbound-failure';

describe('Telegram inbound failure classification', () => {
  it('classifies malformed payloads as permanent without retaining payload details', () => {
    expect(classifyTelegramInboundFailure(new Error('Telegram update is malformed'))).toEqual({
      code: 'telegram_inbound_malformed_update',
      kind: 'PERMANENT',
    });
  });

  it('classifies lease conflicts and timeout dependencies as retryable', () => {
    expect(classifyTelegramInboundFailure(new TelegramInboundLeaseConflictError())).toEqual({
      code: 'telegram_inbound_lease_conflict',
      kind: 'RETRYABLE',
    });
    const timeout = Object.assign(new Error('sensitive provider response'), { code: 'ETIMEDOUT' });
    expect(classifyTelegramInboundFailure(timeout)).toEqual({
      code: 'telegram_inbound_dependency_transient',
      kind: 'RETRYABLE',
    });
  });

  it('uses exponential backoff with bounded deterministic jitter', () => {
    expect(telegramInboundRetryDelayMilliseconds(1)).toBe(1_017);
    expect(telegramInboundRetryDelayMilliseconds(2)).toBe(2_034);
    expect(telegramInboundRetryDelayMilliseconds(99)).toBe(
      telegramInboundRetryDelayMaximumMilliseconds,
    );
  });
});
