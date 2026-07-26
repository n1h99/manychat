import { createHash } from 'node:crypto';

export interface CrmCallContext {
  correlationId: string;
  crmProjectId: string;
  idempotencyKey: string;
  projectId: string;
}

export interface CreateOrUpdateLeadInput {
  contactId: string;
  displayName: string;
  fields: Record<string, unknown>;
}

export interface ForwardInboundMessageInput {
  contactId: string;
  message: { text?: string; type: string };
  normalizedEventId: string;
}

export interface CrmResult {
  operationId: string;
  providerReference: string;
}

export interface CrmClient {
  createOrUpdateLead(context: CrmCallContext, input: CreateOrUpdateLeadInput): Promise<CrmResult>;
  forwardInboundMessage(
    context: CrmCallContext,
    input: ForwardInboundMessageInput,
  ): Promise<CrmResult>;
}

export type MockCrmOutcome = 'PERMANENT_FAILURE' | 'RETRYABLE_FAILURE' | 'SUCCESS' | 'UNKNOWN';

export class CrmMockError extends Error {
  constructor(
    public readonly outcome: Exclude<MockCrmOutcome, 'SUCCESS'>,
    message = 'CRM mock operation did not succeed',
  ) {
    super(message);
    this.name = 'CrmMockError';
  }
}

export class MockCrmClient implements CrmClient {
  private readonly results = new Map<string, CrmResult>();

  constructor(private readonly outcomeFor: (key: string) => MockCrmOutcome = () => 'SUCCESS') {}

  async createOrUpdateLead(
    context: CrmCallContext,
    _input: CreateOrUpdateLeadInput,
  ): Promise<CrmResult> {
    return this.perform(context, 'lead');
  }

  async forwardInboundMessage(
    context: CrmCallContext,
    _input: ForwardInboundMessageInput,
  ): Promise<CrmResult> {
    return this.perform(context, 'message');
  }

  private perform(context: CrmCallContext, kind: 'lead' | 'message'): CrmResult {
    const known = this.results.get(context.idempotencyKey);
    if (known) return known;
    const outcome = this.outcomeFor(context.idempotencyKey);
    if (outcome !== 'SUCCESS') throw new CrmMockError(outcome);
    const digest = createHash('sha256')
      .update(`${context.projectId}:${context.crmProjectId}:${context.idempotencyKey}:${kind}`)
      .digest('hex')
      .slice(0, 24);
    const result = { operationId: `mock-${kind}-${digest}`, providerReference: `mock-${digest}` };
    this.results.set(context.idempotencyKey, result);
    return result;
  }
}
