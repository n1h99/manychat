import { timingSafeEqual } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelSecretsService, type EncryptedSecretEnvelope } from '@omnicus/channel-secrets';
import type { ApiEnvironment } from '@omnicus/config/server';

import { DatabaseService } from '../database/database.service';

export interface TelegramWebhookConnection {
  id: string;
  projectId: string;
  webhookSecretEncrypted: EncryptedSecretEnvelope;
}

@Injectable()
export class ChannelConnectionService {
  private readonly logger = new Logger(ChannelConnectionService.name);
  private readonly secrets: ChannelSecretsService;

  constructor(
    @Inject(ConfigService) config: ConfigService<ApiEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.secrets = new ChannelSecretsService(config.get('CHANNEL_SECRETS_KEY', { infer: true }));
  }

  async findActiveTelegramConnection(connectionId: string): Promise<TelegramWebhookConnection> {
    const connection = await this.database.client.channelConnection.findUnique({
      select: {
        id: true,
        projectId: true,
        status: true,
        type: true,
        webhookSecretEncrypted: true,
      },
      where: { id: connectionId },
    });

    if (!connection || connection.type !== 'TELEGRAM' || connection.status !== 'ACTIVE') {
      throw new NotFoundException({
        code: 'WEBHOOK_CONNECTION_NOT_FOUND',
        message: 'Webhook connection was not found',
      });
    }

    return {
      id: connection.id,
      projectId: connection.projectId,
      webhookSecretEncrypted:
        connection.webhookSecretEncrypted as unknown as EncryptedSecretEnvelope,
    };
  }

  async verifyWebhookSecret(
    connection: TelegramWebhookConnection,
    presentedSecret: string | undefined,
  ): Promise<boolean> {
    if (!presentedSecret) {
      return false;
    }

    let expectedSecret: string;
    try {
      expectedSecret = this.secrets.decryptSecret({
        channelConnectionId: connection.id,
        channelType: 'telegram',
        envelope: connection.webhookSecretEncrypted,
        field: 'webhookSecret',
        projectId: connection.projectId,
      });
    } catch {
      await this.markSecretFailure(connection);
      throw new ServiceUnavailableException({
        code: 'WEBHOOK_SECRET_UNAVAILABLE',
        message: 'Webhook verification is temporarily unavailable',
      });
    }

    const expected = Buffer.from(expectedSecret, 'utf8');
    const presented = Buffer.from(presentedSecret, 'utf8');
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }

  async markWebhookReceived(connectionId: string): Promise<void> {
    await this.database.client.channelConnection.update({
      data: { lastWebhookAt: new Date() },
      where: { id: connectionId },
    });
  }

  private async markSecretFailure(connection: TelegramWebhookConnection): Promise<void> {
    try {
      await this.database.client.channelConnection.update({
        data: { lastErrorAt: new Date(), status: 'ERROR' },
        where: { projectId_id: { id: connection.id, projectId: connection.projectId } },
      });
    } catch {
      this.logger.error({
        connectionId: connection.id,
        message: 'Channel secret decryption failed',
        projectId: connection.projectId,
      });
    }
  }
}
