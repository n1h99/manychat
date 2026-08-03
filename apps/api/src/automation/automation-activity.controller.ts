import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequireProjectPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AutomationActivityService } from './automation-activity.service';
import { AutomationActivityQueryDto } from './dto';

@ApiTags('automation activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('api/v1/projects/:projectId/automation-activity')
export class AutomationActivityController {
  constructor(
    @Inject(AutomationActivityService)
    private readonly activity: AutomationActivityService,
  ) {}

  @Get()
  @RequireProjectPermission('automation:read')
  @ApiQuery({ type: AutomationActivityQueryDto })
  async list(@Param('projectId') projectId: string, @Query() query: AutomationActivityQueryDto) {
    return { data: await this.activity.list(projectId, query), meta: {} };
  }
}
