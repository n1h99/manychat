import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';

import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { CorrelatedRequest } from '../platform/correlation-id.middleware';
import { TelegramWebhookService } from './telegram-webhook.service';

@ApiTags('telegram-webhooks')
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(@Inject(TelegramWebhookService) private readonly webhook: TelegramWebhookService) {}

  @Post(':connectionId')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    description: 'Telegram webhook secret token. This value is never logged or returned.',
    name: 'X-Telegram-Bot-Api-Secret-Token',
    required: true,
  })
  @ApiBody({
    schema: {
      additionalProperties: true,
      properties: { update_id: { type: 'integer' } },
      required: ['update_id'],
      type: 'object',
    },
  })
  @ApiResponse({ description: 'Webhook accepted or a duplicate acknowledged.', status: 200 })
  @ApiResponse({ description: 'Malformed update.', status: 400 })
  @ApiResponse({ description: 'Webhook secret was rejected.', status: 401 })
  async receive(
    @Param('connectionId') connectionId: string,
    @Body() payload: unknown,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<{ ok: true }> {
    const result = await this.webhook.receive(
      connectionId,
      firstHeaderValue(request.headers['x-telegram-bot-api-secret-token']),
      payload,
      {
        correlationId: request.correlationId ?? 'unavailable',
        ip: request.ip,
        userAgent: firstHeaderValue(request.headers['user-agent']),
      },
    );

    if (!result.accepted) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_SECRET_REJECTED',
        message: 'Webhook secret was rejected',
      });
    }

    return { ok: true };
  }
}
