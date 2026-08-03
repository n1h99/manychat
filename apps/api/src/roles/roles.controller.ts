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

import { RequireGlobalPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import type { RequestSecurityContext } from '../auth/auth.service';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateGlobalRoleDto, UpdateGlobalRoleDto } from './dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequireGlobalPermission('roles:manage')
@Controller('api/v1/roles')
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @Get()
  async list() {
    return { data: await this.roles.list(), meta: {} };
  }

  @Get('permissions')
  async permissions() {
    return { data: await this.roles.permissions(), meta: {} };
  }

  @Post()
  @ApiBody({ type: CreateGlobalRoleDto })
  async create(@Body() body: CreateGlobalRoleDto, @Req() request: AuthenticatedRequest) {
    return { data: await this.roles.create(body, request.auth!, this.context(request)), meta: {} };
  }

  @Patch(':roleId')
  @ApiBody({ type: UpdateGlobalRoleDto })
  async update(
    @Param('roleId') roleId: string,
    @Body() body: UpdateGlobalRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.roles.update(roleId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Delete(':roleId')
  async remove(@Param('roleId') roleId: string, @Req() request: AuthenticatedRequest) {
    await this.roles.remove(roleId, request.auth!, this.context(request));
    return { data: { id: roleId }, meta: {} };
  }

  private context(request: AuthenticatedRequest): RequestSecurityContext {
    return {
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }
}
