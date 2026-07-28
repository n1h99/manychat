import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@omnicus/config/server';
import { ChannelSecretsService, type EncryptedSecretEnvelope } from '@omnicus/channel-secrets';
import {
  TelegramAdapter,
  TelegramApiError,
  TelegramHttpTransport,
} from '@omnicus/channel-telegram';
import {
  MediaValidationError,
  prepareMediaForTelegram,
  S3MediaStorage,
  type MediaKind,
} from '@omnicus/media-core';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { DatabaseService } from '../database/database.service';

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class MediaService {
  private readonly maximumBytes: number;
  private readonly retentionDays: number;
  private readonly signedUrlTtl: number;
  private readonly secrets: ChannelSecretsService;
  private readonly storage: S3MediaStorage | undefined;
  private readonly telegram = new TelegramAdapter(new TelegramHttpTransport());

  constructor(
    @Inject(ConfigService) config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.maximumBytes = config.get('MEDIA_MAX_UPLOAD_BYTES', { infer: true });
    this.retentionDays = config.get('MEDIA_RETENTION_DAYS', { infer: true });
    this.signedUrlTtl = config.get('MEDIA_SIGNED_URL_TTL_SECONDS', { infer: true });
    this.secrets = new ChannelSecretsService(config.get('CHANNEL_SECRETS_KEY', { infer: true }));
    if (config.get('MEDIA_STORAGE_ENABLED', { infer: true })) {
      this.storage = new S3MediaStorage({
        accessKeyId: config.get('MEDIA_BUCKET_ACCESS_KEY_ID', { infer: true })!,
        bucket: config.get('MEDIA_BUCKET', { infer: true })!,
        endpoint: config.get('MEDIA_BUCKET_ENDPOINT', { infer: true })!,
        forcePathStyle: config.get('MEDIA_BUCKET_FORCE_PATH_STYLE', { infer: true }),
        region: config.get('MEDIA_BUCKET_REGION', { infer: true }),
        secretAccessKey: config.get('MEDIA_BUCKET_SECRET_ACCESS_KEY', { infer: true })!,
      });
    }
  }

  async list(projectId: string) {
    const assets = await this.database.client.mediaAsset.findMany({
      orderBy: { createdAt: 'desc' },
      where: { projectId, status: { not: 'DELETED' } },
    });
    return assets.map((asset) => this.safe(asset));
  }

  async get(projectId: string, assetId: string) {
    const asset = await this.asset(projectId, assetId);
    return this.safe(asset);
  }

  async upload(
    projectId: string,
    kind: MediaKind,
    file: UploadedFile | undefined,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const stored = await this.store(projectId, kind, file);
    await this.audit.record({
      action: 'media.uploaded',
      actorUserId: actor.userId,
      afterSafeJson: { kind, sizeBytes: stored.sizeBytes },
      correlationId: context.correlationId,
      entityId: stored.asset.id,
      entityType: 'MediaAsset',
      projectId,
    });
    return this.safe(stored.asset);
  }

  async uploadFromService(
    projectId: string,
    kind: MediaKind,
    file: UploadedFile | undefined,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const digest = createHash('sha256')
      .update(`${projectId}:crm-media:${idempotencyKey}`)
      .digest('hex');
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(
      13,
      16,
    )}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const stored = await this.store(projectId, kind, file, id);
    await this.audit.record({
      action: 'crm.media_uploaded',
      actorType: 'SERVICE',
      afterSafeJson: { kind, sizeBytes: stored.sizeBytes },
      correlationId,
      entityId: stored.asset.id,
      entityType: 'MediaAsset',
      projectId,
    });
    return this.safe(stored.asset);
  }

  private async store(
    projectId: string,
    kind: MediaKind,
    file: UploadedFile | undefined,
    requestedId?: string,
  ) {
    if (!file)
      throw new BadRequestException({ code: 'MEDIA_FILE_REQUIRED', message: 'A file is required' });
    const storage = this.requireStorage();
    let validated;
    try {
      validated = await prepareMediaForTelegram({
        bytes: file.buffer,
        declaredMimeType: file.mimetype,
        filename: file.originalname,
        kind,
        maximumBytes: this.maximumBytes,
      });
    } catch (error) {
      if (error instanceof MediaValidationError)
        throw new BadRequestException({ code: error.code, message: 'Media file was rejected' });
      throw error;
    }
    const id = requestedId ?? randomUUID();
    const bucketKey = `${projectId}/assets/${id}.${validated.extension}`;
    const checksumSha256 = createHash('sha256').update(validated.bytes).digest('hex');
    const existing = await this.database.client.mediaAsset.findUnique({
      where: { projectId_id: { id, projectId } },
    });
    if (existing && (existing.kind !== kind || existing.checksumSha256 !== checksumSha256))
      throw new ConflictException({
        code: 'MEDIA_IDEMPOTENCY_CONFLICT',
        message: 'The media idempotency key was already used for different content',
      });
    if (existing?.status === 'AVAILABLE')
      return { asset: existing, sizeBytes: validated.sizeBytes };
    const pending = existing
      ? await this.database.client.mediaAsset.update({
          data: {
            bucketKey,
            checksumSha256,
            declaredMimeType: file.mimetype,
            detectedMimeType: validated.mimeType,
            extension: validated.extension,
            originalFilename: file.originalname,
            sizeBytes: BigInt(validated.sizeBytes),
            status: 'PENDING_UPLOAD',
          },
          where: { projectId_id: { id, projectId } },
        })
      : await this.database.client.mediaAsset.create({
          data: {
            bucketKey,
            checksumSha256,
            declaredMimeType: file.mimetype,
            detectedMimeType: validated.mimeType,
            extension: validated.extension,
            id,
            kind,
            originalFilename: file.originalname,
            projectId,
            sizeBytes: BigInt(validated.sizeBytes),
            source: 'USER_UPLOAD',
            status: 'PENDING_UPLOAD',
          },
        });
    try {
      await storage.putObject(bucketKey, validated.bytes, validated.mimeType, {
        assetId: id,
        projectId,
      });
    } catch {
      await this.database.client.mediaAsset.updateMany({
        data: { status: 'UNAVAILABLE' },
        where: { id, projectId, status: 'PENDING_UPLOAD' },
      });
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'Media storage is temporarily unavailable',
      });
    }
    const asset = await this.database.client.mediaAsset.update({
      data: { availableAt: new Date(), status: 'AVAILABLE' },
      where: { projectId_id: { id: pending.id, projectId } },
    });
    return { asset, sizeBytes: validated.sizeBytes };
  }

  async materialize(
    projectId: string,
    assetId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const asset = await this.asset(projectId, assetId);
    if (asset.status === 'AVAILABLE') return this.safe(asset);
    if (
      asset.source !== 'TELEGRAM' ||
      !asset.connectionId ||
      !asset.providerMediaId ||
      asset.status !== 'PROVIDER_REFERENCE'
    )
      throw new BadRequestException({
        code: 'MEDIA_CANNOT_MATERIALIZE',
        message: 'Media cannot be materialized',
      });
    const storage = this.requireStorage();
    const connection = await this.database.client.channelConnection.findUnique({
      where: { projectId_id: { id: asset.connectionId, projectId } },
    });
    if (!connection)
      throw new NotFoundException({
        code: 'MEDIA_CONNECTION_NOT_FOUND',
        message: 'Media connection was not found',
      });
    const token = this.secrets.decryptSecret({
      channelConnectionId: connection.id,
      channelType: 'telegram',
      envelope: connection.credentialsEncrypted as unknown as EncryptedSecretEnvelope,
      field: 'botToken',
      projectId,
    });
    let downloaded: { bytes: Uint8Array; filePath: string };
    try {
      downloaded = await this.telegram.downloadFile(
        token,
        asset.providerMediaId,
        this.maximumBytes,
      );
    } catch (error) {
      if (error instanceof TelegramApiError && error.errorCode === 400)
        await this.database.client.mediaAsset.update({
          data: { status: 'UNAVAILABLE' },
          where: { projectId_id: { id: asset.id, projectId } },
        });
      throw new ServiceUnavailableException({
        code: 'TELEGRAM_MEDIA_UNAVAILABLE',
        message: 'Telegram media is unavailable',
      });
    }
    let validated;
    try {
      validated = await prepareMediaForTelegram({
        bytes: downloaded.bytes,
        ...(asset.declaredMimeType ? { declaredMimeType: asset.declaredMimeType } : {}),
        ...(asset.originalFilename ? { filename: asset.originalFilename } : {}),
        kind: asset.kind as MediaKind,
        maximumBytes: this.maximumBytes,
      });
    } catch (error) {
      const code = error instanceof MediaValidationError ? error.code : 'media_validation_failed';
      await this.database.client.mediaAsset.update({
        data: { rejectedAt: new Date(), status: 'REJECTED' },
        where: { projectId_id: { id: asset.id, projectId } },
      });
      throw new BadRequestException({ code, message: 'Telegram media was rejected' });
    }
    const bucketKey = `${projectId}/telegram/${asset.id}.${validated.extension}`;
    try {
      await storage.putObject(bucketKey, validated.bytes, validated.mimeType, {
        assetId: asset.id,
        projectId,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'Media storage is temporarily unavailable',
      });
    }
    const updated = await this.database.client.mediaAsset.update({
      data: {
        availableAt: new Date(),
        bucketKey,
        checksumSha256: createHash('sha256').update(validated.bytes).digest('hex'),
        detectedMimeType: validated.mimeType,
        extension: validated.extension,
        providerMetadata: {
          ...(asset.providerMetadata as object | null),
          materializedFromTelegram: true,
        },
        retentionUntil: new Date(Date.now() + this.retentionDays * 86_400_000),
        sizeBytes: BigInt(validated.sizeBytes),
        status: 'AVAILABLE',
      },
      where: { projectId_id: { id: asset.id, projectId } },
    });
    await this.audit.record({
      action: 'media.materialized',
      actorUserId: actor.userId,
      afterSafeJson: { kind: asset.kind, sizeBytes: validated.sizeBytes },
      correlationId: context.correlationId,
      entityId: asset.id,
      entityType: 'MediaAsset',
      projectId,
    });
    return this.safe(updated);
  }

  async signedUrl(projectId: string, assetId: string) {
    const asset = await this.asset(projectId, assetId);
    if (asset.status !== 'AVAILABLE' || !asset.bucketKey)
      throw new BadRequestException({
        code: 'MEDIA_NOT_AVAILABLE',
        message: 'Media is not available',
      });
    return {
      expiresInSeconds: this.signedUrlTtl,
      url: await this.requireStorage().signedDownloadUrl(asset.bucketKey, this.signedUrlTtl),
    };
  }

  async remove(
    projectId: string,
    assetId: string,
    actor: AuthenticatedUser,
    context: RequestSecurityContext,
  ) {
    const asset = await this.asset(projectId, assetId);
    const publishedUsage = await this.database.client.messageTemplateVersion.count({
      where: {
        mediaAssetId: assetId,
        projectId,
        status: { in: ['PUBLISHED', 'SUPERSEDED'] },
      },
    });
    if (publishedUsage)
      throw new BadRequestException({
        code: 'MEDIA_USED_BY_PUBLISHED_TEMPLATE',
        message: 'Published templates still reference this media',
      });
    if (asset.bucketKey) await this.requireStorage().deleteObject(asset.bucketKey);
    await this.database.client.mediaAsset.update({
      data: { bucketKey: null, deletedAt: new Date(), status: 'DELETED' },
      where: { projectId_id: { id: assetId, projectId } },
    });
    await this.audit.record({
      action: 'media.deleted',
      actorUserId: actor.userId,
      correlationId: context.correlationId,
      entityId: assetId,
      entityType: 'MediaAsset',
      projectId,
    });
    return { deleted: true };
  }

  private async asset(projectId: string, assetId: string) {
    const asset = await this.database.client.mediaAsset.findUnique({
      where: { projectId_id: { id: assetId, projectId } },
    });
    if (!asset)
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'Media asset was not found',
      });
    return asset;
  }

  private requireStorage(): S3MediaStorage {
    if (!this.storage)
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_NOT_CONFIGURED',
        message: 'Media storage is not configured',
      });
    return this.storage;
  }

  private safe(asset: {
    bucketKey: string | null;
    sizeBytes: bigint | null;
    [key: string]: unknown;
  }) {
    const safe: Record<string, unknown> = { ...asset };
    delete safe.bucketKey;
    safe.sizeBytes = asset.sizeBytes?.toString() ?? null;
    return safe;
  }
}
