import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';

import { RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AutomationService } from './automation.service';
import { CreateScenarioDto, DuplicateScenarioDto, UpdateScenarioDto } from './dto';

@ApiTags('automation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/scenarios')
export class AutomationController {
  constructor(@Inject(AutomationService) private readonly automation: AutomationService) {}

  @Get()
  @RequireProjectPermission('automation:read')
  async list(@Param('projectId') projectId: string) {
    return { data: await this.automation.list(projectId), meta: {} };
  }

  @Post()
  @RequireProjectPermission('automation:manage')
  @ApiBody({ type: CreateScenarioDto })
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateScenarioDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.create(projectId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Get(':scenarioId')
  @RequireProjectPermission('automation:read')
  async get(@Param('projectId') projectId: string, @Param('scenarioId') scenarioId: string) {
    return { data: await this.automation.get(projectId, scenarioId), meta: {} };
  }

  @Get(':scenarioId/executions')
  @RequireProjectPermission('automation:read')
  async executions(@Param('projectId') projectId: string, @Param('scenarioId') scenarioId: string) {
    return { data: await this.automation.executions(projectId, scenarioId), meta: {} };
  }

  @Patch(':scenarioId')
  @RequireProjectPermission('automation:manage')
  @ApiBody({ type: UpdateScenarioDto })
  async update(
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
    @Body() body: UpdateScenarioDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.update(
        projectId,
        scenarioId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':scenarioId/publish')
  @RequireProjectPermission('automation:manage')
  async publish(
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.publish(
        projectId,
        scenarioId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':scenarioId/duplicate')
  @RequireProjectPermission('automation:manage')
  @ApiBody({ type: DuplicateScenarioDto })
  async duplicate(
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
    @Body() body: DuplicateScenarioDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.duplicate(
        projectId,
        scenarioId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':scenarioId/versions/:versionId/restore')
  @RequireProjectPermission('automation:manage')
  async restoreVersion(
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
    @Param('versionId') versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.restoreVersion(
        projectId,
        scenarioId,
        versionId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':scenarioId/pause')
  @RequireProjectPermission('automation:manage')
  async pause(
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.setStatus(
        projectId,
        scenarioId,
        'PAUSED',
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':scenarioId/resume')
  @RequireProjectPermission('automation:manage')
  async resume(
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.setStatus(
        projectId,
        scenarioId,
        'PUBLISHED',
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Delete(':scenarioId')
  @RequireProjectPermission('automation:manage')
  async remove(
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automation.archive(
        projectId,
        scenarioId,
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
