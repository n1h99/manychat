import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';

import { RequireGlobalPermission, RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import type { RequestSecurityContext } from '../auth/auth.service';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountLifecycleService } from './account-lifecycle.service';
import {
  AcceptInvitationDto,
  CreateGlobalInvitationDto,
  CreateProjectInvitationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  TokenDto,
} from './dto';

function context(request: AuthenticatedRequest): RequestSecurityContext {
  return {
    correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
    ip: request.ip,
    userAgent: firstHeaderValue(request.headers['user-agent']),
  };
}

@ApiTags('account-lifecycle')
@Controller('api/v1/auth')
export class PublicAccountLifecycleController {
  constructor(
    @Inject(AccountLifecycleService) private readonly lifecycle: AccountLifecycleService,
  ) {}

  @Post('forgot-password')
  @ApiBody({ type: ForgotPasswordDto })
  async forgot(@Body() body: ForgotPasswordDto, @Req() request: AuthenticatedRequest) {
    return {
      data: await this.lifecycle.requestPasswordReset(body.email, context(request)),
      meta: {},
    };
  }

  @Post('password-reset/preview')
  @ApiBody({ type: TokenDto })
  async previewReset(@Body() body: TokenDto) {
    return { data: await this.lifecycle.previewPasswordReset(body), meta: {} };
  }

  @Post('reset-password')
  @ApiBody({ type: ResetPasswordDto })
  async reset(@Body() body: ResetPasswordDto, @Req() request: AuthenticatedRequest) {
    return { data: await this.lifecycle.resetPassword(body, context(request)), meta: {} };
  }

  @Post('invitations/preview')
  @ApiBody({ type: TokenDto })
  async previewInvitation(@Body() body: TokenDto) {
    return { data: await this.lifecycle.previewInvitation(body), meta: {} };
  }

  @Post('invitations/accept')
  @ApiBody({ type: AcceptInvitationDto })
  async acceptInvitation(@Body() body: AcceptInvitationDto, @Req() request: AuthenticatedRequest) {
    return { data: await this.lifecycle.acceptInvitation(body, context(request)), meta: {} };
  }
}

@ApiTags('global-invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/users')
export class GlobalInvitationsController {
  constructor(
    @Inject(AccountLifecycleService) private readonly lifecycle: AccountLifecycleService,
  ) {}

  @Get('invitations')
  @RequireGlobalPermission('users:read')
  async list() {
    return { data: await this.lifecycle.listGlobalInvitations(), meta: {} };
  }

  @Post('invitations')
  @RequireGlobalPermission('users:manage')
  @ApiBody({ type: CreateGlobalInvitationDto })
  async create(@Body() body: CreateGlobalInvitationDto, @Req() request: AuthenticatedRequest) {
    return {
      data: await this.lifecycle.createGlobalInvitation(body, request.auth!, context(request)),
      meta: {},
    };
  }

  @Delete('invitations/:invitationId')
  @RequireGlobalPermission('users:manage')
  async revoke(@Param('invitationId') invitationId: string, @Req() request: AuthenticatedRequest) {
    await this.lifecycle.revokeGlobalInvitation(invitationId, request.auth!, context(request));
    return { data: { id: invitationId }, meta: {} };
  }

  @Post(':userId/password-reset-link')
  @RequireGlobalPermission('users:manage')
  async resetLink(@Param('userId') userId: string, @Req() request: AuthenticatedRequest) {
    return {
      data: await this.lifecycle.createPasswordResetLink(userId, request.auth!, context(request)),
      meta: {},
    };
  }
}

@ApiTags('project-invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/invitations')
export class ProjectInvitationsController {
  constructor(
    @Inject(AccountLifecycleService) private readonly lifecycle: AccountLifecycleService,
  ) {}

  @Get()
  @RequireProjectPermission('project:read')
  async list(@Param('projectId') projectId: string) {
    return { data: await this.lifecycle.listProjectInvitations(projectId), meta: {} };
  }

  @Post()
  @RequireProjectPermission('members:manage')
  @ApiBody({ type: CreateProjectInvitationDto })
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateProjectInvitationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.lifecycle.createProjectInvitation(
        projectId,
        body,
        request.auth!,
        context(request),
      ),
      meta: {},
    };
  }

  @Delete(':invitationId')
  @RequireProjectPermission('members:manage')
  async revoke(
    @Param('projectId') projectId: string,
    @Param('invitationId') invitationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.lifecycle.revokeProjectInvitation(
      projectId,
      invitationId,
      request.auth!,
      context(request),
    );
    return { data: { id: invitationId }, meta: {} };
  }
}
