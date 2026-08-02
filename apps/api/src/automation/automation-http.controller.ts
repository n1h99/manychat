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
import {
  CreateAutomationSecretDto,
  TestExternalHttpRequestDto,
  UpdateAutomationSecretDto,
} from './automation-http.dto';
import { AutomationHttpService } from './automation-http.service';

@ApiTags('automation http')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/automation')
export class AutomationHttpController {
  constructor(
    @Inject(AutomationHttpService) private readonly automationHttp: AutomationHttpService,
  ) {}

  @Get('secrets')
  @RequireProjectPermission('automation:read')
  async listSecrets(@Param('projectId') projectId: string) {
    return { data: await this.automationHttp.listSecrets(projectId), meta: {} };
  }

  @Post('secrets')
  @RequireProjectPermission('automation:manage')
  @ApiBody({ type: CreateAutomationSecretDto })
  async createSecret(
    @Param('projectId') projectId: string,
    @Body() body: CreateAutomationSecretDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automationHttp.createSecret(
        projectId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Patch('secrets/:secretId')
  @RequireProjectPermission('automation:manage')
  @ApiBody({ type: UpdateAutomationSecretDto })
  async updateSecret(
    @Param('projectId') projectId: string,
    @Param('secretId') secretId: string,
    @Body() body: UpdateAutomationSecretDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automationHttp.updateSecret(
        projectId,
        secretId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Delete('secrets/:secretId')
  @RequireProjectPermission('automation:manage')
  async archiveSecret(
    @Param('projectId') projectId: string,
    @Param('secretId') secretId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automationHttp.archiveSecret(
        projectId,
        secretId,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  @Post('http/test')
  @RequireProjectPermission('automation:manage')
  @ApiBody({ type: TestExternalHttpRequestDto })
  async testRequest(
    @Param('projectId') projectId: string,
    @Body() body: TestExternalHttpRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.automationHttp.testRequest(
        projectId,
        body,
        request.auth!,
        this.context(request),
      ),
      meta: {},
    };
  }

  private context(request: AuthenticatedRequest): RequestSecurityContext {
    return {
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'missing',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }
}
