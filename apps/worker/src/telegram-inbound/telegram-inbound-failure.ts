import { Prisma } from '@omnicus/database';

export type TelegramInboundFailureKind = 'PERMANENT' | 'RETRYABLE';

export interface TelegramInboundFailure {
  code: string;
  kind: TelegramInboundFailureKind;
}

export class TelegramInboundLeaseConflictError extends Error {
  constructor() {
    super('Telegram inbound lease was replaced before completion');
    this.name = 'TelegramInboundLeaseConflictError';
  }
}

export class TelegramInboundReactionIdentityMismatchError extends Error {
  constructor() {
    super('Telegram reaction actor does not match the target conversation identity');
    this.name = 'TelegramInboundReactionIdentityMismatchError';
  }
}

export class TelegramInboundReactionTargetPendingError extends Error {
  constructor() {
    super('Telegram reaction target message is not available yet');
    this.name = 'TelegramInboundReactionTargetPendingError';
  }
}

const retryablePrismaCodes = new Set(['P1001', 'P1002', 'P1008', 'P1017']);
const permanentPrismaCodes = new Set(['P2002', 'P2003', 'P2025']);
const retryableNetworkCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

export function classifyTelegramInboundFailure(error: unknown): TelegramInboundFailure {
  if (error instanceof TelegramInboundLeaseConflictError) {
    return { code: 'telegram_inbound_lease_conflict', kind: 'RETRYABLE' };
  }
  if (error instanceof TelegramInboundReactionTargetPendingError) {
    return { code: 'telegram_inbound_reaction_target_pending', kind: 'RETRYABLE' };
  }
  if (error instanceof TelegramInboundReactionIdentityMismatchError) {
    return { code: 'telegram_inbound_reaction_identity_mismatch', kind: 'PERMANENT' };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (retryablePrismaCodes.has(error.code)) {
      return { code: 'telegram_inbound_database_transient', kind: 'RETRYABLE' };
    }
    if (permanentPrismaCodes.has(error.code)) {
      return { code: 'telegram_inbound_data_constraint', kind: 'PERMANENT' };
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return { code: 'telegram_inbound_database_transient', kind: 'RETRYABLE' };
  }

  if (error instanceof Error) {
    if (error.message === 'Telegram update is malformed') {
      return { code: 'telegram_inbound_malformed_update', kind: 'PERMANENT' };
    }
    if (error.message === 'Telegram identity subject is missing') {
      return { code: 'telegram_inbound_missing_identity_subject', kind: 'PERMANENT' };
    }
    if (error.name === 'TimeoutError') {
      return { code: 'telegram_inbound_timeout', kind: 'RETRYABLE' };
    }
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode && retryableNetworkCodes.has(errorCode)) {
      return { code: 'telegram_inbound_dependency_transient', kind: 'RETRYABLE' };
    }
  }

  return { code: 'telegram_inbound_processing_failed', kind: 'RETRYABLE' };
}

const retryBaseDelayMilliseconds = 1_000;
export const telegramInboundRetryDelayMaximumMilliseconds = 300_000;

/**
 * The bounded deterministic jitter avoids synchronized retries while keeping
 * recovery tests reproducible. It is capped at 250 ms and never exceeds the
 * retry delay ceiling.
 */
export function telegramInboundRetryDelayMilliseconds(attempts: number): number {
  const normalizedAttempts = Math.max(1, attempts);
  const exponential = retryBaseDelayMilliseconds * 2 ** (normalizedAttempts - 1);
  const capped = Math.min(exponential, telegramInboundRetryDelayMaximumMilliseconds);
  const jitter = Math.min(250, normalizedAttempts * 17);
  return Math.min(telegramInboundRetryDelayMaximumMilliseconds, capped + jitter);
}
