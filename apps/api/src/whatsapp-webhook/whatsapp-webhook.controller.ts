import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { CorrelatedRequest } from '../platform/correlation-id.middleware';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

type RawRequest = AuthenticatedRequest & CorrelatedRequest & Request & { rawBody?: Buffer };

@ApiTags('whatsapp-webhooks')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(@Inject(WhatsAppWebhookService) private readonly webhook: WhatsAppWebhookService) {}

  @Get()
  @ApiResponse({ description: 'Meta webhook challenge accepted.', status: 200 })
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    return this.webhook.verifyChallenge(mode, token, challenge);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'X-Hub-Signature-256', required: true })
  @ApiResponse({ description: 'Verified webhook items durably accepted.', status: 200 })
  async receive(@Body() payload: unknown, @Req() request: RawRequest): Promise<{ ok: true }> {
    await this.webhook.receive(
      request.rawBody,
      firstHeaderValue(request.headers['x-hub-signature-256']),
      payload,
      {
        correlationId: request.correlationId ?? 'unavailable',
        ip: request.ip,
        userAgent: firstHeaderValue(request.headers['user-agent']),
      },
    );
    return { ok: true };
  }
}
