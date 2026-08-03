import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiTags } from '@nestjs/swagger';

import { RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import type { RequestSecurityContext } from '../auth/auth.service';
import { firstHeaderValue, type AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditQueryDto, ManualRetryDto, OperationsQueryDto, ReconcileUnknownDto } from './dto';
import { OperationsService } from './operations.service';

@ApiTags('operations')
@ApiBearerAuth()
@ApiExtraModels(AuditQueryDto, OperationsQueryDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Get('operations')
  @RequireProjectPermission('project:read')
  async list(
    @Param('projectId') projectId: string,
    @Query() query: OperationsQueryDto,
  ): Promise<{ data: unknown; meta: Record<string, never> }> {
    return { data: await this.operations.list(projectId, query), meta: {} };
  }

  @Get('operations/summary')
  @RequireProjectPermission('project:read')
  async summary(
    @Param('projectId') projectId: string,
  ): Promise<{ data: unknown; meta: Record<string, never> }> {
    return { data: await this.operations.summary(projectId), meta: {} };
  }

  @Get('audit')
  @RequireProjectPermission('project:read')
  async audit(@Param('projectId') projectId: string, @Query() query: AuditQueryDto) {
    return { data: await this.operations.auditHistory(projectId, query), meta: {} };
  }

  @Post('operations/inbox/:operationId/retry')
  @RequireProjectPermission('project:manage')
  @ApiBody({ type: ManualRetryDto })
  async retryInbox(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Body() body: ManualRetryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.operations.retryInbox(
        projectId,
        operationId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post('operations/outbox/:operationId/retry')
  @RequireProjectPermission('project:manage')
  @ApiBody({ type: ManualRetryDto })
  async retryOutbox(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Body() body: ManualRetryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.operations.retryOutbox(
        projectId,
        operationId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post('operations/outbox/:operationId/reconcile')
  @RequireProjectPermission('project:manage')
  @ApiBody({ type: ReconcileUnknownDto })
  async reconcileOutbox(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Body() body: ReconcileUnknownDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.operations.reconcileOutbox(
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
