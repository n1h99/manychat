import { describe, expect, it } from 'vitest';

import { assertBullMqReadiness, shouldScheduleDemoJob } from './demo-queue.service';

describe('BullMQ readiness', () => {
  it('rejects a ready producer with a failed consumer', () => {
    expect(() =>
      assertBullMqReadiness({
        consumerReady: false,
        producerReady: true,
      }),
    ).toThrow(/consumer=false/);
  });

  it('rejects a ready consumer with a failed producer', () => {
    expect(() =>
      assertBullMqReadiness({
        consumerReady: true,
        producerReady: false,
      }),
    ).toThrow(/producer=false/);
  });

  it('accepts readiness only when producer and consumer are ready', () => {
    expect(() =>
      assertBullMqReadiness({
        consumerReady: true,
        producerReady: true,
      }),
    ).not.toThrow();
  });
});

describe('Stage 0 demo job gate', () => {
  it.each(['production', 'staging'] as const)(
    'does not schedule demo jobs in %s',
    (environment) => {
      expect(shouldScheduleDemoJob(environment, true)).toBe(false);
    },
  );

  it('requires an explicit feature flag in development', () => {
    expect(shouldScheduleDemoJob('development', false)).toBe(false);
    expect(shouldScheduleDemoJob('development', true)).toBe(true);
  });
});
