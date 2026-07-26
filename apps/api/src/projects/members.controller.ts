import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { AddMemberDto, UpdateMembershipDto } from './dto';
import { MembersService } from './members.service';

@ApiTags('project-members')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  @RequireProjectPermission('project:read')
  async list(@Param('projectId') projectId: string) {
    return { data: await this.members.list(projectId), meta: {} };
  }

  @Post()
  @RequireProjectPermission('members:manage')
  @ApiBody({ type: AddMemberDto })
  async add(
    @Param('projectId') projectId: string,
    @Body() body: AddMemberDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.members.add(projectId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Patch(':membershipId')
  @RequireProjectPermission('members:manage')
  @ApiBody({ type: UpdateMembershipDto })
  async update(
    @Param('projectId') projectId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: UpdateMembershipDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.members.update(
        projectId,
        membershipId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Delete(':membershipId')
  @HttpCode(204)
  @RequireProjectPermission('members:manage')
  async remove(
    @Param('projectId') projectId: string,
    @Param('membershipId') membershipId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.members.remove(projectId, membershipId, request.auth!, this.context(request));
  }

  private context(request: AuthenticatedRequest): RequestSecurityContext {
    return {
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }
}
