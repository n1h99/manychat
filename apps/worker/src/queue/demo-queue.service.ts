import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnvironment } from '@omnicus/config';
import type { HealthDependency } from '@omnicus/contracts';
import { Queue, Worker, type Job } from 'bullmq';

import {
  DEMO_JOB_NAME,
  DEMO_QUEUE_NAME,
  executeDemoJob,
  type DemoJobInput,
  type DemoJobResult,
} from './demo-job';
import { redisConnectionFromUrl } from './redis-connection';

@Injectable()
export class DemoQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DemoQueueService.name);
  private readonly queue: Queue<DemoJobInput, DemoJobResult, string>;
  private readonly worker: Worker<DemoJobInput, DemoJobResult, string>;

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<WorkerEnvironment, true>,
  ) {
    const connection = redisConnectionFromUrl(config.get('REDIS_URL', { infer: true }));
    this.queue = new Queue(DEMO_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          delay: 1_000,
          type: 'exponential',
        },
        removeOnComplete: 25,
        removeOnFail: 50,
      },
    });
    this.worker = new Worker(
      DEMO_QUEUE_NAME,
      async (job: Job<DemoJobInput, DemoJobResult, string>) => {
        if (job.name !== DEMO_JOB_NAME) {
          throw new Error(`Unsupported Stage 0 job: ${job.name}`);
        }
        return executeDemoJob(job.data);
      },
      {
        concurrency: 1,
        connection,
      },
    );
    this.worker.on('error', (error: Error) => {
      this.logger.error(error.message, error.stack);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.waitUntilReady();

    if (this.config.get('APP_ENV', { infer: true }) !== 'production') {
      await this.queue.add(
        DEMO_JOB_NAME,
        { requestedAt: new Date().toISOString() },
        { jobId: `stage0-${Date.now()}` },
      );
    }
  }

  async check(): Promise<HealthDependency> {
    const startedAt = performance.now();
    await this.queue.getJobCounts('active', 'waiting', 'failed');
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: 'up',
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
