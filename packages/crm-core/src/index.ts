import { createHash } from 'node:crypto';

import { z } from 'zod';

export interface CrmCallContext {
  correlationId: string;
  crmProjectId: string;
  idempotencyKey: string;
  projectId: string;
}

export interface CrmIdentityInput {
  channel: 'telegram';
  channelIdentityId: string;
  connectionId: string;
  externalChatId?: string;
  externalUserId?: string;
}

export interface CrmTagInput {
  id: string;
  name: string;
}

export interface CrmMediaInput {
  assetId: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
  emoji?: string;
  fileName?: string;
  kind: 'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'STICKER' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE';
  mimeType?: string;
  hasSpoiler?: boolean;
  mediaGroupId?: string;
  setName?: string;
  size?: number;
  type: 'audio' | 'file' | 'image' | 'sticker' | 'video';
}

export interface CrmInteractiveInput {
  callbackQueryId: string;
  data?: string;
  displayText?: string;
  sourceMessageId?: string;
  type: 'callback_query';
}

export interface CrmInlineKeyboardButtonInput {
  callbackData?: string;
  text: string;
  url?: string;
}

export type CrmInlineKeyboardInput = CrmInlineKeyboardButtonInput[][];

export interface CrmMessageEntityInput {
  customEmojiId?: string;
  language?: string;
  length: number;
  offset: number;
  type: string;
  url?: string;
}

export interface CrmLinkPreviewOptionsInput {
  isDisabled?: boolean;
  preferLargeMedia?: boolean;
  preferSmallMedia?: boolean;
  showAboveText?: boolean;
  url?: string;
}

export type CrmReactionInput =
  | { emoji: string; type: 'emoji' }
  | { customEmojiId: string; type: 'custom_emoji' }
  | { type: 'paid' };

export interface CrmReactionActorInput {
  displayName: string;
  externalUserId: string;
  type: 'user';
  username?: string;
}

export interface CreateOrUpdateLeadInput {
  contactId: string;
  contactStatus?: string;
  customFields: Record<string, unknown>;
  displayName?: string;
  email?: string;
  identity: CrmIdentityInput;
  phone?: string;
  tags: CrmTagInput[];
  username?: string;
}

export interface ForwardInboundMessageInput {
  contactId: string;
  identity: CrmIdentityInput;
  interactive?: CrmInteractiveInput;
  media?: CrmMediaInput;
  messageId?: string;
  normalizedEventId?: string;
  occurredAt: string;
  senderName?: string;
  text?: string;
}

export interface ForwardOutboundMessageInput {
  broadcastId?: string;
  contactId: string;
  deliveryStatus: 'SENT';
  identity: CrmIdentityInput;
  inlineKeyboard?: CrmInlineKeyboardInput;
  entities?: CrmMessageEntityInput[];
  hasSpoiler?: boolean;
  linkPreviewOptions?: CrmLinkPreviewOptionsInput;
  media?: CrmMediaInput;
  messageId: string;
  messageEffectId?: string;
  occurredAt: string;
  protectContent?: boolean;
  providerMessageId: string;
  quote?: string;
  quotePosition?: number;
  replyToMessageId?: string;
  scenarioExecutionId?: string;
  senderName?: string;
  source: 'AUTOMATION' | 'BROADCAST' | 'SYSTEM';
  text?: string;
}

export interface ForwardReactionEventInput {
  actor: CrmReactionActorInput;
  contactId: string;
  identity: CrmIdentityInput;
  messageId: string;
  newReactions: CrmReactionInput[];
  normalizedEventId: string;
  occurredAt: string;
  oldReactions: CrmReactionInput[];
}

export interface CrmResult {
  mode: string;
  operationId: string;
  providerReference: string;
}

export type CrmReconciliationResult =
  | { status: 'NOT_FOUND' }
  | {
      errorCode?: string;
      operationId: string;
      result?: Record<string, unknown>;
      status: 'FAILED' | 'PROCESSING' | 'SUCCEEDED';
    };

export interface CrmClient {
  createOrUpdateLead(context: CrmCallContext, input: CreateOrUpdateLeadInput): Promise<CrmResult>;
  forwardInboundMessage(
    context: CrmCallContext,
    input: ForwardInboundMessageInput,
  ): Promise<CrmResult>;
  forwardOutboundMessage(
    context: CrmCallContext,
    input: ForwardOutboundMessageInput,
  ): Promise<CrmResult>;
  forwardReactionEvent(
    context: CrmCallContext,
    input: ForwardReactionEventInput,
  ): Promise<CrmResult>;
  reconcile(context: CrmCallContext): Promise<CrmReconciliationResult>;
}

export type CrmFailureOutcome = 'PERMANENT_FAILURE' | 'RETRYABLE_FAILURE' | 'UNKNOWN';

export class CrmClientError extends Error {
  constructor(
    public readonly outcome: CrmFailureOutcome,
    public readonly safeCode: string,
    public readonly retryAfterMs?: number,
  ) {
    super(safeCode);
    this.name = 'CrmClientError';
  }
}

const leadResultSchema = z.object({
  crmLeadId: z.string().min(1),
  mode: z.enum(['created', 'updated']),
  operationId: z.string().min(1),
});

const messageResultSchema = z.object({
  crmLeadId: z.string().min(1),
  crmMessageId: z.string().min(1),
  mode: z.enum(['created', 'duplicate']),
  operationId: z.string().min(1),
});

const reactionResultSchema = z.object({
  crmLeadId: z.string().min(1),
  crmReactionEventId: z.string().min(1),
  mode: z.enum(['created', 'duplicate']),
  operationId: z.string().min(1),
});

const operationSchema = z.object({
  errorCode: z.string().optional(),
  operationId: z.string().min(1),
  result: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['PROCESSING', 'SUCCEEDED', 'FAILED']),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    retryable: z.boolean().optional(),
  }),
});

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HttpCrmClientOptions {
  authToken: string;
  baseUrl: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs: number;
}

export class HttpCrmClient implements CrmClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;

  constructor(private readonly options: HttpCrmClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async createOrUpdateLead(
    context: CrmCallContext,
    input: CreateOrUpdateLeadInput,
  ): Promise<CrmResult> {
    const payload = {
      contactStatus: input.contactStatus,
      crmProjectId: context.crmProjectId,
      customFields: input.customFields,
      email: input.email,
      identity: input.identity,
      name: input.displayName,
      omnicusContactId: input.contactId,
      omnicusProjectId: context.projectId,
      phone: input.phone,
      tags: input.tags,
      username: input.username,
    };
    const result = await this.postAndReconcile(
      '/integrations/v1/omnicus/leads/upsert',
      context,
      payload,
      leadResultSchema,
    );
    return {
      mode: result.mode,
      operationId: result.operationId,
      providerReference: result.crmLeadId,
    };
  }

  async forwardInboundMessage(
    context: CrmCallContext,
    input: ForwardInboundMessageInput,
  ): Promise<CrmResult> {
    const payload = {
      crmProjectId: context.crmProjectId,
      identity: input.identity,
      interactive: input.interactive,
      media: input.media,
      messageId: input.messageId,
      normalizedEventId: input.normalizedEventId,
      occurredAt: input.occurredAt,
      omnicusContactId: input.contactId,
      omnicusProjectId: context.projectId,
      senderName: input.senderName,
      text: input.text,
    };
    const result = await this.postAndReconcile(
      '/integrations/v1/omnicus/messages/inbound',
      context,
      payload,
      messageResultSchema,
    );
    return {
      mode: result.mode,
      operationId: result.operationId,
      providerReference: result.crmMessageId,
    };
  }

  async forwardOutboundMessage(
    context: CrmCallContext,
    input: ForwardOutboundMessageInput,
  ): Promise<CrmResult> {
    const payload = {
      broadcastId: input.broadcastId,
      crmProjectId: context.crmProjectId,
      deliveryStatus: input.deliveryStatus,
      identity: input.identity,
      inlineKeyboard: input.inlineKeyboard,
      entities: input.entities,
      hasSpoiler: input.hasSpoiler,
      linkPreviewOptions: input.linkPreviewOptions,
      media: input.media,
      messageId: input.messageId,
      messageEffectId: input.messageEffectId,
      occurredAt: input.occurredAt,
      omnicusContactId: input.contactId,
      omnicusProjectId: context.projectId,
      providerMessageId: input.providerMessageId,
      protectContent: input.protectContent,
      quote: input.quote,
      quotePosition: input.quotePosition,
      replyToMessageId: input.replyToMessageId,
      scenarioExecutionId: input.scenarioExecutionId,
      senderName: input.senderName,
      source: input.source,
      text: input.text,
    };
    const result = await this.postAndReconcile(
      '/integrations/v1/omnicus/messages/outbound',
      context,
      payload,
      messageResultSchema,
    );
    return {
      mode: result.mode,
      operationId: result.operationId,
      providerReference: result.crmMessageId,
    };
  }

  async forwardReactionEvent(
    context: CrmCallContext,
    input: ForwardReactionEventInput,
  ): Promise<CrmResult> {
    const payload = {
      actor: input.actor,
      crmProjectId: context.crmProjectId,
      identity: input.identity,
      messageId: input.messageId,
      newReactions: input.newReactions,
      normalizedEventId: input.normalizedEventId,
      occurredAt: input.occurredAt,
      oldReactions: input.oldReactions,
      omnicusContactId: input.contactId,
      omnicusProjectId: context.projectId,
    };
    const result = await this.postAndReconcile(
      '/integrations/v1/omnicus/reactions/inbound',
      context,
      payload,
      reactionResultSchema,
    );
    return {
      mode: result.mode,
      operationId: result.operationId,
      providerReference: result.crmReactionEventId,
    };
  }

  async reconcile(context: CrmCallContext): Promise<CrmReconciliationResult> {
    const url = new URL('/integrations/v1/omnicus/operations', `${this.baseUrl}/`);
    url.searchParams.set('crmProjectId', context.crmProjectId);
    url.searchParams.set('idempotencyKey', context.idempotencyKey);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: this.headers(context, false),
        method: 'GET',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      throw new CrmClientError('UNKNOWN', 'crm_reconciliation_unavailable');
    }
    if (response.status === 404) return { status: 'NOT_FOUND' };
    if (!response.ok)
      throw this.httpError(response.status, await this.safeJson(response), response);
    const parsed = operationSchema.safeParse(await this.safeJson(response));
    if (!parsed.success) throw new CrmClientError('UNKNOWN', 'crm_reconciliation_response_invalid');
    return {
      operationId: parsed.data.operationId,
      status: parsed.data.status,
      ...(parsed.data.errorCode === undefined ? {} : { errorCode: parsed.data.errorCode }),
      ...(parsed.data.result === undefined ? {} : { result: parsed.data.result }),
    };
  }

  private async postAndReconcile<T extends z.ZodType>(
    path: string,
    context: CrmCallContext,
    payload: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        body: JSON.stringify(payload),
        headers: this.headers(context, true),
        method: 'POST',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      const body = await this.safeJson(response);
      if (!response.ok) throw this.httpError(response.status, body, response);
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new CrmClientError('UNKNOWN', 'crm_response_invalid');
      return parsed.data;
    } catch (error) {
      const classified =
        error instanceof CrmClientError
          ? error
          : new CrmClientError('UNKNOWN', 'crm_transport_outcome_unknown');
      if (classified.outcome !== 'UNKNOWN') throw classified;
      return this.resolveUnknown(context, schema, classified);
    }
  }

  private async resolveUnknown<T extends z.ZodType>(
    context: CrmCallContext,
    schema: T,
    original: CrmClientError,
  ): Promise<z.infer<T>> {
    let operation: CrmReconciliationResult;
    try {
      operation = await this.reconcile(context);
    } catch {
      throw original;
    }
    if (operation.status === 'NOT_FOUND') throw original;
    if (operation.status === 'PROCESSING')
      throw new CrmClientError('RETRYABLE_FAILURE', 'crm_operation_in_progress', 1_000);
    if (operation.status === 'FAILED')
      throw new CrmClientError('PERMANENT_FAILURE', operation.errorCode ?? 'crm_operation_failed');
    const parsed = schema.safeParse(operation.result);
    if (!parsed.success) throw new CrmClientError('UNKNOWN', 'crm_reconciliation_result_invalid');
    return parsed.data;
  }

  private headers(context: CrmCallContext, contentType: boolean): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.authToken}`,
      ...(contentType ? { 'Content-Type': 'application/json' } : {}),
      'Idempotency-Key': context.idempotencyKey,
      'X-Correlation-Id': context.correlationId,
    };
  }

  private httpError(status: number, body: unknown, response: Response): CrmClientError {
    const parsed = errorSchema.safeParse(body);
    const safeCode = parsed.success
      ? (parsed.data.error.code ?? `crm_http_${status}`)
      : `crm_http_${status}`;
    const retryAfter = this.retryAfterMilliseconds(response.headers.get('retry-after'));
    if (status === 429 || status >= 500)
      return new CrmClientError('RETRYABLE_FAILURE', safeCode, retryAfter);
    return new CrmClientError('PERMANENT_FAILURE', safeCode);
  }

  private retryAfterMilliseconds(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300_000, seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.min(300_000, Math.max(0, date - Date.now()));
  }

  private async safeJson(response: Response): Promise<unknown> {
    return response.json().catch(() => undefined);
  }
}

export type MockCrmOutcome = CrmFailureOutcome | 'SUCCESS';

export class CrmMockError extends CrmClientError {
  constructor(outcome: Exclude<MockCrmOutcome, 'SUCCESS'>) {
    super(outcome, `crm_mock_${outcome.toLowerCase()}`);
    this.name = 'CrmMockError';
  }
}

export class MockCrmClient implements CrmClient {
  private readonly results = new Map<string, CrmResult>();
  private readonly resultKinds = new Map<
    string,
    'lead' | 'message' | 'outbound-message' | 'reaction'
  >();

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

  async forwardOutboundMessage(
    context: CrmCallContext,
    _input: ForwardOutboundMessageInput,
  ): Promise<CrmResult> {
    return this.perform(context, 'outbound-message');
  }

  async forwardReactionEvent(
    context: CrmCallContext,
    _input: ForwardReactionEventInput,
  ): Promise<CrmResult> {
    return this.perform(context, 'reaction');
  }

  async reconcile(context: CrmCallContext): Promise<CrmReconciliationResult> {
    const result = this.results.get(context.idempotencyKey);
    const kind = this.resultKinds.get(context.idempotencyKey);
    return result
      ? {
          operationId: result.operationId,
          result: {
            ...(kind === 'lead'
              ? { crmLeadId: result.providerReference }
              : kind === 'reaction'
                ? { crmLeadId: 'mock-lead', crmReactionEventId: result.providerReference }
                : { crmMessageId: result.providerReference }),
            mode: result.mode,
            operationId: result.operationId,
          },
          status: 'SUCCEEDED',
        }
      : { status: 'NOT_FOUND' };
  }

  private perform(
    context: CrmCallContext,
    kind: 'lead' | 'message' | 'outbound-message' | 'reaction',
  ): CrmResult {
    const known = this.results.get(context.idempotencyKey);
    if (known) return known;
    const outcome = this.outcomeFor(context.idempotencyKey);
    if (outcome !== 'SUCCESS') throw new CrmMockError(outcome);
    const digest = createHash('sha256')
      .update(`${context.projectId}:${context.crmProjectId}:${context.idempotencyKey}:${kind}`)
      .digest('hex')
      .slice(0, 24);
    const result = {
      mode: 'created',
      operationId: `mock-${kind}-${digest}`,
      providerReference: `mock-${digest}`,
    };
    this.results.set(context.idempotencyKey, result);
    this.resultKinds.set(context.idempotencyKey, kind);
    return result;
  }
}
