import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';

import { RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { ChannelsService } from './channels.service';
import { CreateTelegramChannelDto, TestTelegramMessageDto, UpdateTelegramChannelDto } from './dto';
import type { ChannelEventsQueryDto, CompleteWhatsAppSetupDto } from './dto';
import { WhatsAppChannelsService } from './whatsapp-channels.service';

@ApiTags('channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/channels')
export class ChannelsController {
  constructor(
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(WhatsAppChannelsService) private readonly whatsApp: WhatsAppChannelsService,
  ) {}
  @Get() @RequireProjectPermission('channels:read') async list(
    @Param('projectId') projectId: string,
  ) {
    return { data: await this.channels.list(projectId), meta: {} };
  }
  @Get('whatsapp/setup')
  @RequireProjectPermission('channels:read')
  async whatsAppSetup() {
    return { data: this.whatsApp.setup(), meta: {} };
  }
  @Post('whatsapp/setup/complete')
  @RequireProjectPermission('channels:manage')
  async completeWhatsAppSetup(
    @Param('projectId') projectId: string,
    @Body() dto: CompleteWhatsAppSetupDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.whatsApp.complete(projectId, dto, request.auth!, this.context(request)),
      meta: {},
    };
  }
  @Post()
  @RequireProjectPermission('channels:manage')
  @ApiBody({ type: CreateTelegramChannelDto })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTelegramChannelDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.channels.create(projectId, dto, request.auth!, this.context(request)),
      meta: {},
    };
  }
  @Get(':connectionId') @RequireProjectPermission('channels:read') async get(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return { data: await this.channels.get(projectId, connectionId), meta: {} };
  }
  @Get(':connectionId/inbound-events')
  @RequireProjectPermission('channels:read')
  async inboundEvents(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Query() query: ChannelEventsQueryDto,
  ) {
    return {
      data: await this.channels.inboundEvents(projectId, connectionId, query),
      meta: {},
    };
  }
  @Get(':connectionId/outbound-events')
  @RequireProjectPermission('channels:read')
  async outboundEvents(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Query() query: ChannelEventsQueryDto,
  ) {
    return {
      data: await this.channels.outboundEvents(projectId, connectionId, query),
      meta: {},
    };
  }
  @Get(':connectionId/identities')
  @RequireProjectPermission('channels:manage')
  async identities(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return {
      data: await this.channels.identities(projectId, connectionId),
      meta: {},
    };
  }
  @Get(':connectionId/whatsapp/templates')
  @RequireProjectPermission('channels:read')
  async whatsAppTemplates(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return { data: await this.whatsApp.templates(projectId, connectionId), meta: {} };
  }
  @Post(':connectionId/whatsapp/templates/sync')
  @RequireProjectPermission('channels:manage')
  async syncWhatsAppTemplates(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return { data: await this.whatsApp.syncTemplates(projectId, connectionId), meta: {} };
  }
  @Patch(':connectionId')
  @RequireProjectPermission('channels:manage')
  @ApiBody({ type: UpdateTelegramChannelDto })
  async update(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: UpdateTelegramChannelDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.channels.update(
        projectId,
        connectionId,
        dto,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }
  @Post(':connectionId/test') @RequireProjectPermission('channels:manage') async test(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.channels.test(projectId, connectionId, request.auth!, this.context(request)),
      meta: {},
    };
  }
  @Post(':connectionId/connect')
  @RequireProjectPermission('channels:manage')
  async connect(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.channels.connect(
        projectId,
        connectionId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }
  @Post(':connectionId/disable') @RequireProjectPermission('channels:manage') async disable(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.channels.disable(
        projectId,
        connectionId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }
  @Post(':connectionId/rotate-secret')
  @RequireProjectPermission('channels:rotate_secrets')
  async rotate(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.channels.rotateSecret(
        projectId,
        connectionId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }
  @Post(':connectionId/test-message')
  @RequireProjectPermission('channels:manage')
  @ApiBody({ type: TestTelegramMessageDto })
  async testMessage(
    @Param('projectId') projectId: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: TestTelegramMessageDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.channels.createTestMessage(
        projectId,
        connectionId,
        dto,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }
  private context(request: AuthenticatedRequest): RequestSecurityContext {
    return {
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }
}
