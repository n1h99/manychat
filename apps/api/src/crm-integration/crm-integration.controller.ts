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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { MediaService } from '../media/media.service';
import { CrmIntegrationAuthGuard } from './crm-integration-auth.guard';
import { CrmOutboundService } from './crm-outbound.service';
import { CrmOperationQueryDto, CrmOutboundMessageDto } from './dto';
import type { CrmMediaUploadDto } from './dto';

@ApiTags('crm integration')
@ApiBearerAuth()
@UseGuards(CrmIntegrationAuthGuard)
@Controller('integrations/v1/crm')
export class CrmIntegrationController {
  constructor(
    @Inject(CrmOutboundService) private readonly outbound: CrmOutboundService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Post('media')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Correlation-Id', required: true })
  @ApiBody({
    schema: {
      properties: {
        crmProjectId: { type: 'string' },
        file: { format: 'binary', type: 'string' },
        kind: {
          enum: ['PHOTO', 'DOCUMENT', 'VIDEO', 'AUDIO', 'VOICE', 'VIDEO_NOTE', 'ANIMATION'],
          type: 'string',
        },
        omnicusProjectId: { type: 'string' },
      },
      required: ['crmProjectId', 'omnicusProjectId', 'kind', 'file'],
      type: 'object',
    },
  })
  async uploadMedia(
    @Body() dto: CrmMediaUploadDto,
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          mimetype: string;
          originalname: string;
          size: number;
        }
      | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    this.assertHeaders(idempotencyKey, correlationId);
    await this.outbound.assertProjectRoute(dto.crmProjectId, dto.omnicusProjectId);
    const asset = await this.media.uploadFromService(
      dto.omnicusProjectId,
      dto.kind,
      file,
      idempotencyKey!,
      correlationId!,
    );
    return {
      kind: asset.kind,
      mediaAssetId: asset.id,
      sizeBytes: asset.sizeBytes,
      status: asset.status,
    };
  }

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
    this.assertHeaders(idempotencyKey, correlationId);
    return this.outbound.queue(dto, idempotencyKey!, correlationId!);
  }

  @Get('operations/:operationId')
  @ApiQuery({ type: CrmOperationQueryDto })
  @ApiOkResponse({ description: 'Current durable Telegram delivery status' })
  async operation(@Param('operationId') operationId: string, @Query() query: CrmOperationQueryDto) {
    return this.outbound.status(operationId, query.crmProjectId, query.omnicusProjectId);
  }

  private assertHeaders(
    idempotencyKey: string | undefined,
    correlationId: string | undefined,
  ): void {
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
  }
}
