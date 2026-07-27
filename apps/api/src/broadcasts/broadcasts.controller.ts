import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';

import { RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto, UpdateBroadcastDto } from './dto';
import type { BroadcastRecipientsQueryDto } from './dto';

@ApiTags('broadcasts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/broadcasts')
export class BroadcastsController {
  constructor(@Inject(BroadcastsService) private readonly broadcasts: BroadcastsService) {}

  @Get()
  @RequireProjectPermission('broadcasts:read')
  async list(@Param('projectId') projectId: string) {
    return { data: await this.broadcasts.list(projectId), meta: {} };
  }

  @Post()
  @RequireProjectPermission('broadcasts:create')
  @ApiBody({ type: CreateBroadcastDto })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateBroadcastDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.broadcasts.create(projectId, dto, this.context(request)), meta: {} };
  }

  @Get(':broadcastId')
  @RequireProjectPermission('broadcasts:read')
  async get(@Param('projectId') projectId: string, @Param('broadcastId') broadcastId: string) {
    return { data: await this.broadcasts.get(projectId, broadcastId), meta: {} };
  }

  @Patch(':broadcastId')
  @RequireProjectPermission('broadcasts:create')
  @ApiBody({ type: UpdateBroadcastDto })
  async update(
    @Param('projectId') projectId: string,
    @Param('broadcastId') broadcastId: string,
    @Body() dto: UpdateBroadcastDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.broadcasts.update(projectId, broadcastId, dto, this.context(request)),
      meta: {},
    };
  }

  @Post(':broadcastId/estimate')
  @RequireProjectPermission('broadcasts:read')
  async estimate(@Param('projectId') projectId: string, @Param('broadcastId') broadcastId: string) {
    return { data: await this.broadcasts.estimate(projectId, broadcastId), meta: {} };
  }

  @Post(':broadcastId/launch')
  @RequireProjectPermission('broadcasts:launch')
  async launch(
    @Param('projectId') projectId: string,
    @Param('broadcastId') broadcastId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.broadcasts.launch(projectId, broadcastId, this.context(request)),
      meta: {},
    };
  }

  @Post(':broadcastId/pause')
  @RequireProjectPermission('broadcasts:pause')
  async pause(
    @Param('projectId') projectId: string,
    @Param('broadcastId') broadcastId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.broadcasts.pause(projectId, broadcastId, this.context(request)),
      meta: {},
    };
  }

  @Post(':broadcastId/resume')
  @RequireProjectPermission('broadcasts:launch')
  async resume(
    @Param('projectId') projectId: string,
    @Param('broadcastId') broadcastId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.broadcasts.resume(projectId, broadcastId, this.context(request)),
      meta: {},
    };
  }

  @Post(':broadcastId/cancel')
  @RequireProjectPermission('broadcasts:cancel')
  async cancel(
    @Param('projectId') projectId: string,
    @Param('broadcastId') broadcastId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.broadcasts.cancel(projectId, broadcastId, this.context(request)),
      meta: {},
    };
  }

  @Post(':broadcastId/retry-failed')
  @RequireProjectPermission('broadcasts:launch')
  async retryFailed(
    @Param('projectId') projectId: string,
    @Param('broadcastId') broadcastId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.broadcasts.retryFailed(projectId, broadcastId, this.context(request)),
      meta: {},
    };
  }

  @Get(':broadcastId/recipients')
  @RequireProjectPermission('broadcasts:read')
  async recipients(
    @Param('projectId') projectId: string,
    @Param('broadcastId') broadcastId: string,
    @Query() query: BroadcastRecipientsQueryDto,
  ) {
    return { data: await this.broadcasts.recipients(projectId, broadcastId, query), meta: {} };
  }

  private context(
    request: AuthenticatedRequest,
  ): RequestSecurityContext & { actorUserId: string; actorEmail: string } {
    return {
      actorEmail: request.auth!.email,
      actorUserId: request.auth!.userId,
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }
}
