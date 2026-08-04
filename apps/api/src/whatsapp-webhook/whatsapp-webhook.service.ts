import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  splitWhatsAppWebhookEnvelope,
  WhatsAppWebhookEnvelopeError,
  type WhatsAppWebhookItem,
} from '@omnicus/channel-whatsapp';
import type { ApiEnvironment } from '@omnicus/config/server';
import { Prisma } from '@omnicus/database';

import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { WhatsAppInboundQueueService } from './whatsapp-inbound-queue.service';

const retentionMilliseconds = 30 * 24 * 60 * 60 * 1_000;
const signaturePrefix = 'sha256=';
const expectedSignatureHexLength = 64;
const signaturePrefixLength = signaturePrefix.length;

const signatureInvalidReason = {
  HEADER_MISSING: 'SIGNATURE_HEADER_MISSING',
  PREFIX_INVALID: 'SIGNATURE_PREFIX_INVALID',
  HEX_INVALID: 'SIGNATURE_HEX_INVALID',
  LENGTH_INVALID: 'SIGNATURE_LENGTH_INVALID',
  MISMATCH: 'SIGNATURE_MISMATCH',
} as const;

type SignatureInvalidReason = (typeof signatureInvalidReason)[keyof typeof signatureInvalidReason];

type SignatureCheckResult = {
  valid: boolean;
  reason: SignatureInvalidReason | null;
  signaturePresent: boolean;
  signatureHasSha256Prefix: boolean;
  signatureHexLength: number | null;
  signatureHexValid: boolean;
};

export interface WhatsAppWebhookContext {
  correlationId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

function isDuplicate(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WhatsAppInboundQueueService) private readonly queue: WhatsAppInboundQueueService,
  ) {}

  verifyChallenge(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    const expected = this.config.get('WHATSAPP_META_WEBHOOK_VERIFY_TOKEN', { infer: true });
    if (
      mode !== 'subscribe' ||
      !token ||
      !challenge ||
      !expected ||
      !this.safeEqual(token, expected)
    )
      throw new ForbiddenException({
        code: 'WHATSAPP_WEBHOOK_VERIFICATION_REJECTED',
        message: 'WhatsApp webhook verification was rejected',
      });
    return challenge;
  }

  async receive(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    parsedBody: unknown,
    context: WhatsAppWebhookContext,
  ): Promise<{
    accepted: true;
    duplicates: number;
    persisted: number;
    unknownConnections: number;
  }> {
    if (!rawBody)
      throw new BadRequestException({
        code: 'WHATSAPP_RAW_BODY_REQUIRED',
        message: 'WhatsApp request bytes are unavailable',
      });
    const appSecret = this.config.get('WHATSAPP_META_APP_SECRET', { infer: true });
    if (!appSecret)
      throw new ForbiddenException({
        code: 'WHATSAPP_META_CONFIGURATION_REQUIRED',
        message: 'WhatsApp webhook configuration is incomplete',
      });
    const signatureResult = this.evaluateSignature(rawBody, signature, appSecret);
    if (!signatureResult.valid) {
      await this.recordRejected(context, rawBody, signatureResult, appSecret);
      throw new ForbiddenException({
        code: 'WHATSAPP_WEBHOOK_SIGNATURE_REJECTED',
        message: 'WhatsApp webhook signature was rejected',
      });
    }

    let items: WhatsAppWebhookItem[];
    try {
      items = splitWhatsAppWebhookEnvelope(parsedBody);
    } catch (error) {
      if (error instanceof WhatsAppWebhookEnvelopeError)
        throw new BadRequestException({
          code: 'WHATSAPP_WEBHOOK_ENVELOPE_OVERSIZED',
          message: 'WhatsApp webhook contains too many events',
        });
      throw error;
    }
    let duplicates = 0;
    let persisted = 0;
    let unknownConnections = 0;
    for (const item of items) {
      const connection = await this.database.client.channelConnection.findFirst({
        select: { id: true, projectId: true },
        where: {
          providerAccountId: item.wabaId,
          providerIdentityId: item.phoneNumberId,
          status: 'ACTIVE',
          type: 'WHATSAPP',
        },
      });
      if (!connection) {
        unknownConnections += 1;
        continue;
      }
      const stored = await this.persist(connection, item, context.correlationId);
      await this.database.client.channelConnection.update({
        data: { lastWebhookAt: new Date() },
        where: { projectId_id: { id: connection.id, projectId: connection.projectId } },
      });
      if (!stored) {
        duplicates += 1;
        continue;
      }
      persisted += 1;
      try {
        await this.queue.enqueue(stored);
      } catch {
        await this.database.client.inboxRecord.update({
          data: { lastError: 'whatsapp_inbound_enqueue_failed' },
          where: { projectId_id: { id: stored, projectId: connection.projectId } },
        });
        this.logger.warn({
          connectionId: connection.id,
          correlationId: context.correlationId,
          inboxRecordId: stored,
          message: 'WhatsApp inbound enqueue failed; durable intent remains pending',
          projectId: connection.projectId,
        });
      }
    }
    return { accepted: true, duplicates, persisted, unknownConnections };
  }

  private async persist(
    connection: { id: string; projectId: string },
    item: WhatsAppWebhookItem,
    correlationId: string,
  ): Promise<string | null> {
    const now = new Date();
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const raw = await transaction.rawWebhookEvent.create({
          data: {
            connectionId: connection.id,
            correlationId,
            externalUpdateId: item.externalEventId,
            payload: item.payload as Prisma.InputJsonValue,
            projectId: connection.projectId,
            purgeAfter: new Date(now.getTime() + retentionMilliseconds),
            receivedAt: now,
            status: 'RECEIVED',
          },
        });
        const inbox = await transaction.inboxRecord.create({
          data: {
            connectionId: connection.id,
            maxAttempts: 8,
            nextAttemptAt: now,
            projectId: connection.projectId,
            rawWebhookEventId: raw.id,
            status: 'PENDING',
          },
          select: { id: true },
        });
        return inbox.id;
      });
    } catch (error) {
      if (isDuplicate(error)) return null;
      throw error;
    }
  }

  private evaluateSignature(
    rawBody: Buffer,
    signature: string | undefined,
    secret: string,
  ): SignatureCheckResult {
    const signaturePresent = signature !== undefined;
    if (!signaturePresent) {
      return {
        valid: false,
        reason: signatureInvalidReason.HEADER_MISSING,
        signaturePresent,
        signatureHasSha256Prefix: false,
        signatureHexLength: null,
        signatureHexValid: false,
      };
    }

    const signatureHasSha256Prefix = signature.startsWith(signaturePrefix);
    if (!signatureHasSha256Prefix) {
      return {
        valid: false,
        reason: signatureInvalidReason.PREFIX_INVALID,
        signaturePresent,
        signatureHasSha256Prefix,
        signatureHexLength: null,
        signatureHexValid: false,
      };
    }

    const presentedHex = signature.slice(signaturePrefixLength);
    const signatureHexLengthValue = presentedHex.length;
    if (!/^[a-f0-9]+$/i.test(presentedHex)) {
      return {
        valid: false,
        reason: signatureInvalidReason.HEX_INVALID,
        signaturePresent,
        signatureHasSha256Prefix,
        signatureHexLength: signatureHexLengthValue,
        signatureHexValid: false,
      };
    }

    if (presentedHex.length !== expectedSignatureHexLength) {
      return {
        valid: false,
        reason: signatureInvalidReason.LENGTH_INVALID,
        signaturePresent,
        signatureHasSha256Prefix,
        signatureHexLength: signatureHexLengthValue,
        signatureHexValid: true,
      };
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const presented = Buffer.from(presentedHex, 'hex');
    const valid = expected.length === presented.length && timingSafeEqual(expected, presented);
    return {
      valid,
      reason: valid ? null : signatureInvalidReason.MISMATCH,
      signaturePresent,
      signatureHasSha256Prefix,
      signatureHexLength: signatureHexLengthValue,
      signatureHexValid: true,
    };
  }

  private rejectionLog(
    context: WhatsAppWebhookContext,
    rawBody: Buffer,
    details: SignatureCheckResult,
    appSecret: string,
  ): void {
    const appSecretLength = appSecret.length;
    const reason = details.reason ?? signatureInvalidReason.MISMATCH;
    this.logger.warn({
      correlationId: context.correlationId,
      ip: context.ip,
      message: 'WhatsApp webhook signature rejected',
      appSecretLength,
      appSecretPresent: appSecretLength > 0,
      rawBodyLength: rawBody.length,
      rawBodyPresent: true,
      signatureHexLength: details.signatureHexLength,
      signatureHasSha256Prefix: details.signatureHasSha256Prefix,
      signaturePresent: details.signaturePresent,
      signatureHexValid: details.signatureHexValid,
      safeReason: reason,
      userAgent: context.userAgent,
    });
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async recordRejected(
    context: WhatsAppWebhookContext,
    rawBody: Buffer,
    details: SignatureCheckResult,
    appSecret: string,
  ): Promise<void> {
    this.rejectionLog(context, rawBody, details, appSecret);
    try {
      await this.audit.record({
        action: 'security.whatsapp_webhook_signature_rejected',
        actorType: 'SYSTEM',
        correlationId: context.correlationId,
        entityType: 'Webhook',
        ip: context.ip,
        reason: 'invalid_or_missing_x_hub_signature_256',
        userAgent: context.userAgent,
      });
    } catch {
      this.logger.error({
        correlationId: context.correlationId,
        message: 'WhatsApp webhook rejection audit could not be persisted',
      });
    }
  }
}
