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
import {
  CloneProjectDto,
  CreateProjectDto,
  CreateProjectRoleDto,
  UpdateProjectDto,
  UpdateProjectRoleDto,
} from './dto';
import { ProjectsService } from './projects.service';
import { ProjectRolesService } from './project-roles.service';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ProjectRolesService) private readonly roles: ProjectRolesService,
  ) {}

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

  @Post(':projectId/clone')
  @RequireGlobalPermission('projects:create')
  @ApiBody({ type: CloneProjectDto })
  async clone(
    @Param('projectId') projectId: string,
    @Body() body: CloneProjectDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.projects.clone(projectId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Get(':projectId/access')
  @RequireProjectPermission('project:read')
  async getAccess(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.projects.getAccess(projectId, request.auth!), meta: {} };
  }

  @Get(':projectId/overview')
  @RequireProjectPermission('project:read')
  async overview(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.projects.overview(projectId, request.auth!), meta: {} };
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

  @Get(':projectId/role-permissions')
  @RequireProjectPermission('project:read')
  async rolePermissions() {
    return { data: await this.roles.permissions(), meta: {} };
  }

  @Post(':projectId/roles')
  @RequireProjectPermission('members:manage')
  @ApiBody({ type: CreateProjectRoleDto })
  async createRole(
    @Param('projectId') projectId: string,
    @Body() body: CreateProjectRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.roles.create(projectId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Patch(':projectId/roles/:roleId')
  @RequireProjectPermission('members:manage')
  @ApiBody({ type: UpdateProjectRoleDto })
  async updateRole(
    @Param('projectId') projectId: string,
    @Param('roleId') roleId: string,
    @Body() body: UpdateProjectRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.roles.update(projectId, roleId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Delete(':projectId/roles/:roleId')
  @RequireProjectPermission('members:manage')
  async removeRole(
    @Param('projectId') projectId: string,
    @Param('roleId') roleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.roles.remove(projectId, roleId, request.auth!, this.context(request));
    return { data: { id: roleId }, meta: {} };
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
