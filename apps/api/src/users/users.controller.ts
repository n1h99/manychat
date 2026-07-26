import {
  Body,
  Controller,
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

import { RequireGlobalPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateUserDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @RequireGlobalPermission('users:read')
  async list() {
    return { data: await this.users.list(), meta: {} };
  }

  @Get('roles/global')
  @RequireGlobalPermission('users:read')
  async listGlobalRoles() {
    return { data: await this.users.listGlobalRoles(), meta: {} };
  }

  @Post()
  @RequireGlobalPermission('users:manage')
  @ApiBody({ type: CreateUserDto })
  async create(@Body() body: CreateUserDto, @Req() request: AuthenticatedRequest) {
    return { data: await this.users.create(body, request.auth!, this.context(request)), meta: {} };
  }

  @Patch(':userId')
  @RequireGlobalPermission('users:manage')
  @ApiBody({ type: UpdateUserDto })
  async update(
    @Param('userId') userId: string,
    @Body() body: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.users.update(userId, body, request.auth!, this.context(request)),
      meta: {},
    };
  }

  @Post(':userId/disable')
  @HttpCode(204)
  @RequireGlobalPermission('users:manage')
  async disable(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.users.disable(userId, request.auth!, this.context(request));
  }

  @Post(':userId/revoke-sessions')
  @HttpCode(204)
  @RequireGlobalPermission('users:manage')
  async revokeSessions(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.users.revokeSessions(userId, request.auth!, this.context(request));
  }

  private context(request: AuthenticatedRequest): RequestSecurityContext {
    return {
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }
}
