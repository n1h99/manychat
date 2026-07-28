import { Body, Controller, Get, Inject, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';

import { RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpsertCrmProjectConfigDto } from './dto';
import { CrmService } from './crm.service';

@ApiTags('crm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/crm-config')
export class CrmController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  @Get()
  @RequireProjectPermission('integrations:manage')
  async get(@Param('projectId') projectId: string) {
    return { data: await this.crm.getConfig(projectId), meta: {} };
  }

  @Put()
  @RequireProjectPermission('integrations:manage')
  @ApiBody({ type: UpsertCrmProjectConfigDto })
  async upsert(
    @Param('projectId') projectId: string,
    @Body() body: UpsertCrmProjectConfigDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.crm.upsertConfig(projectId, body, request.auth!, this.context(request)),
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
