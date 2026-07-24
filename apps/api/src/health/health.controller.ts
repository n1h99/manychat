import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { ApiSuccessBody, LivenessData, ReadinessData } from '@omnicus/contracts';
import { Inject } from '@nestjs/common';

import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthService)
    private readonly health: HealthService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  @ApiOkResponse({ description: 'The API process is alive' })
  liveness(): ApiSuccessBody<LivenessData> {
    return {
      data: {
        service: 'api',
        status: 'live',
        timestamp: new Date().toISOString(),
      },
      meta: {},
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness probe' })
  @ApiOkResponse({ description: 'PostgreSQL and Redis are reachable' })
  @ApiServiceUnavailableResponse({
    description: 'At least one required dependency is unavailable',
  })
  async readiness(): Promise<ApiSuccessBody<ReadinessData>> {
    return {
      data: await this.health.readiness(),
      meta: {},
    };
  }
}
