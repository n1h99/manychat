import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiTags } from '@nestjs/swagger';

import { RequireGlobalPermission } from '../access/access.decorators';
import { PermissionGuard } from '../access/permission.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditQueryDto } from '../operations/dto';
import { SystemHealthService } from './system-health.service';

@ApiTags('system-health')
@ApiBearerAuth()
@ApiExtraModels(AuditQueryDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequireGlobalPermission('roles:manage')
@Controller('api/v1/system')
export class SystemHealthController {
  constructor(@Inject(SystemHealthService) private readonly health: SystemHealthService) {}

  @Get('health')
  async snapshot(): Promise<{ data: unknown; meta: Record<string, never> }> {
    return { data: await this.health.snapshot(), meta: {} };
  }

  @Get('audit')
  async audit(@Query() query: AuditQueryDto) {
    return { data: await this.health.audit(query), meta: {} };
  }
}
