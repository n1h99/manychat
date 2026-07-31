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

import { RequireGlobalPermission, RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return { data: await this.projects.list(request.auth!), meta: {} };
  }

  @Post()
  @RequireGlobalPermission('projects:create')
  @ApiBody({ type: CreateProjectDto })
  async create(@Body() body: CreateProjectDto, @Req() request: AuthenticatedRequest) {
    return {
      data: await this.projects.create(body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Get(':projectId/access')
  @RequireProjectPermission('project:read')
  async getAccess(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.projects.getAccess(projectId, request.auth!), meta: {} };
  }

  @Get(':projectId')
  async get(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.projects.get(projectId, request.auth!), meta: {} };
  }

  @Get(':projectId/roles')
  @RequireProjectPermission('project:read')
  async listRoles(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.projects.listRoles(projectId, request.auth!), meta: {} };
  }

  @Patch(':projectId')
  @RequireProjectPermission('project:manage')
  @ApiBody({ type: UpdateProjectDto })
  async update(
    @Param('projectId') projectId: string,
    @Body() body: UpdateProjectDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.projects.update(projectId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Post(':projectId/pause')
  @RequireProjectPermission('project:manage')
  async pause(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return {
      data: await this.projects.setStatus(
        projectId,
        'PAUSED',
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post(':projectId/activate')
  @RequireProjectPermission('project:manage')
  async activate(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return {
      data: await this.projects.setStatus(
        projectId,
        'ACTIVE',
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Delete(':projectId')
  @RequireProjectPermission('project:manage')
  async remove(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return {
      data: await this.projects.archive(projectId, request.auth!, this.context(request)),
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
