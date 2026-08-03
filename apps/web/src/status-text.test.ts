import { describe, expect, it } from 'vitest';

import { statusTone } from './status-text';

describe('status text tones', () => {
  it('uses semantic success, warning and danger colors', () => {
    expect(statusTone('ACTIVE')).toBe('success');
    expect(statusTone('completed')).toBe('success');
    expect(statusTone('PROVIDER_REFERENCE')).toBe('success');
    expect(statusTone('RECEIVED')).toBe('success');
    expect(statusTone('PAUSED')).toBe('warning');
    expect(statusTone('RUNNING')).toBe('warning');
    expect(statusTone('UNKNOWN')).toBe('warning');
    expect(statusTone('ARCHIVED')).toBe('danger');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('NOT_CONNECTED')).toBe('danger');
    expect(statusTone('UNAVAILABLE')).toBe('danger');
  });
});
