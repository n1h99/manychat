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
import type { RequestSecurityContext } from '../auth/auth.service';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateMessageTemplateDto,
  PreviewMessageTemplateDto,
  UpdateMessageTemplateDto,
} from './dto';
import { TemplatesService } from './templates.service';

@ApiTags('templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/templates')
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @Get()
  @RequireProjectPermission('templates:read')
  async list(@Param('projectId') projectId: string, @Query('archived') archived?: string) {
    return { data: await this.templates.list(projectId, archived === 'true'), meta: {} };
  }

  @Post()
  @RequireProjectPermission('templates:manage')
  @ApiBody({ type: CreateMessageTemplateDto })
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateMessageTemplateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.templates.create(projectId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Get(':templateId')
  @RequireProjectPermission('templates:read')
  async get(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    return { data: await this.templates.get(projectId, templateId), meta: {} };
  }

  @Patch(':templateId')
  @RequireProjectPermission('templates:manage')
  @ApiBody({ type: UpdateMessageTemplateDto })
  async update(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() body: UpdateMessageTemplateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.templates.update(
        projectId,
        templateId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':templateId/publish')
  @RequireProjectPermission('templates:manage')
  async publish(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.templates.publish(
        projectId,
        templateId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':templateId/archive')
  @RequireProjectPermission('templates:manage')
  async archive(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.templates.archive(
        projectId,
        templateId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':templateId/restore')
  @RequireProjectPermission('templates:manage')
  async restore(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.templates.restore(
        projectId,
        templateId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':templateId/preview')
  @RequireProjectPermission('templates:read')
  @ApiBody({ type: PreviewMessageTemplateDto })
  async preview(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() body: PreviewMessageTemplateDto,
  ) {
    return { data: await this.templates.preview(projectId, templateId, body), meta: {} };
  }

  private context(request: AuthenticatedRequest): RequestSecurityContext {
    return {
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }
}
