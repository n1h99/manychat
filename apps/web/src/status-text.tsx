import type { ReactNode } from 'react';

import { humanizeStatus } from './humanize';

const successfulStatuses = new Set([
  'ACCEPTED',
  'ACTIVE',
  'AVAILABLE',
  'APPROVED',
  'COMPLETED',
  'CONNECTED',
  'DELIVERED',
  'ENABLED',
  'HEALTHY',
  'GREEN',
  'PUBLISHED',
  'READY',
  'READ',
  'RECEIVED',
  'RESOLVED',
  'SENT',
  'SUCCEEDED',
  'PROVIDER_REFERENCE',
  'UP',
  'VALID',
]);

const failedStatuses = new Set([
  'ARCHIVED',
  'BLOCKED',
  'CANCELLED',
  'DEAD_LETTER',
  'DELETED',
  'DISABLED',
  'DOWN',
  'ERROR',
  'EXPIRED',
  'FAILED',
  'INACTIVE',
  'MERGED',
  'NOT_CONNECTED',
  'NOT_CREATED',
  'REJECTED',
  'RED',
  'REVOKED',
  'TIMED_OUT',
  'UNAVAILABLE',
  'UNSUBSCRIBED',
]);

export type StatusTone = 'danger' | 'success' | 'warning';

export function statusTone(status: string): StatusTone {
  const normalized = status.trim().toUpperCase();
  if (successfulStatuses.has(normalized)) return 'success';
  if (failedStatuses.has(normalized)) return 'danger';
  return 'warning';
}

export function StatusText({
  className,
  label,
  status,
}: {
  className?: string | undefined;
  label?: ReactNode;
  status?: string | null | undefined;
}) {
  const classes = ['status-text'];
  if (status) classes.push(`status-text--${statusTone(status)}`);
  if (className) classes.push(className);

  return (
    <span className={classes.join(' ')}>
      {label ?? (status ? humanizeStatus(status) : '\u2014')}
    </span>
  );
}
