import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';

import { RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import type { RequestSecurityContext } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RetryCrmOperationDto } from './dto';
import { CrmService } from './crm.service';

@ApiTags('crm mock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/crm-operations')
export class CrmOperationsController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  @Get()
  @RequireProjectPermission('integrations:manage')
  async list(@Param('projectId') projectId: string) {
    return { data: await this.crm.listOperations(projectId), meta: {} };
  }

  @Post(':operationId/retry')
  @RequireProjectPermission('integrations:manage')
  @ApiBody({ type: RetryCrmOperationDto })
  async retry(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Body() body: RetryCrmOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.crm.retryOperation(
        projectId,
        operationId,
        body,
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
