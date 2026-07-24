import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { ApiSuccessBody, HealthDependency, LivenessData } from '@omnicus/contracts';

import { DemoQueueService } from './queue/demo-queue.service';

interface WorkerReadiness {
  dependencies: {
    bullmq: HealthDependency;
  };
  status: 'ready';
}

@Controller('health')
export class WorkerHealthController {
  constructor(
    @Inject(DemoQueueService)
    private readonly queue: DemoQueueService,
  ) {}

  @Get('live')
  liveness(): ApiSuccessBody<LivenessData> {
    return {
      data: {
        service: 'worker',
        status: 'live',
        timestamp: new Date().toISOString(),
      },
      meta: {},
    };
  }

  @Get('ready')
  async readiness(): Promise<ApiSuccessBody<WorkerReadiness>> {
    try {
      return {
        data: {
          dependencies: {
            bullmq: await this.queue.check(),
          },
          status: 'ready',
        },
        meta: {},
      };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'BullMQ producer or consumer is unavailable',
      });
    }
  }
}
