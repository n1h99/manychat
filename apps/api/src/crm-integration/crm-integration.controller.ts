import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CrmIntegrationAuthGuard } from './crm-integration-auth.guard';
import { CrmOutboundService } from './crm-outbound.service';
import { CrmOperationQueryDto, CrmOutboundMessageDto } from './dto';

@ApiTags('crm integration')
@ApiBearerAuth()
@UseGuards(CrmIntegrationAuthGuard)
@Controller('integrations/v1/crm')
export class CrmIntegrationController {
  constructor(@Inject(CrmOutboundService) private readonly outbound: CrmOutboundService) {}

  @Post('messages/outbound')
  @HttpCode(200)
  @ApiBody({ type: CrmOutboundMessageDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Correlation-Id', required: true })
  @ApiOkResponse({ description: 'Message durably queued for Telegram delivery' })
  async message(
    @Body() dto: CrmOutboundMessageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 128)
      throw new BadRequestException({
        code: 'CRM_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required',
      });
    if (!correlationId || correlationId.length > 128)
      throw new BadRequestException({
        code: 'CRM_CORRELATION_ID_REQUIRED',
        message: 'A valid X-Correlation-Id header is required',
      });
    return this.outbound.queue(dto, idempotencyKey, correlationId);
  }

  @Get('operations/:operationId')
  @ApiQuery({ type: CrmOperationQueryDto })
  @ApiOkResponse({ description: 'Current durable Telegram delivery status' })
  async operation(@Param('operationId') operationId: string, @Query() query: CrmOperationQueryDto) {
    return this.outbound.status(operationId, query.crmProjectId, query.omnicusProjectId);
  }
}
