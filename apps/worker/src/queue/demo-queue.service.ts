import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnvironment } from '@omnicus/config/server';
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

export interface BullMqReadinessState {
  consumerReady: boolean;
  producerReady: boolean;
}

export function assertBullMqReadiness(state: BullMqReadinessState): void {
  if (!state.producerReady || !state.consumerReady) {
    throw new Error(
      `BullMQ is not ready (producer=${state.producerReady}, consumer=${state.consumerReady})`,
    );
  }
}

export function shouldScheduleDemoJob(
  appEnvironment: WorkerEnvironment['APP_ENV'],
  enabled: boolean,
): boolean {
  return enabled && (appEnvironment === 'development' || appEnvironment === 'test');
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMilliseconds}ms`)),
      timeoutMilliseconds,
    );
    timeout.unref();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

@Injectable()
export class DemoQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DemoQueueService.name);
  private readonly queue: Queue<DemoJobInput, DemoJobResult, string>;
  private readonly worker: Worker<DemoJobInput, DemoJobResult, string>;
  private consumerError: Error | undefined;
  private consumerReady = false;
  private shuttingDown = false;

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<WorkerEnvironment, true>,
  ) {
    const connection = redisConnectionFromUrl(config.get('REDIS_URL', { infer: true }));
    this.queue = new Queue(DEMO_QUEUE_NAME, {
      connection: {
        ...connection,
        maxRetriesPerRequest: 1,
      },
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
        connection: {
          ...connection,
          maxRetriesPerRequest: null,
        },
      },
    );
    this.worker.on('ready', () => {
      this.consumerError = undefined;
      this.consumerReady = true;
    });
    this.worker.on('error', (error: Error) => {
      this.consumerError = error;
      this.consumerReady = false;
      this.logger.error(error.message, error.stack);
    });
    this.worker.on('closed', () => {
      this.consumerReady = false;
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    const timeout = this.config.get('BULLMQ_READY_TIMEOUT_MS', { infer: true });
    await Promise.all([
      withTimeout(this.queue.waitUntilReady(), timeout, 'BullMQ producer readiness'),
      withTimeout(this.worker.waitUntilReady(), timeout, 'BullMQ consumer readiness'),
    ]);
    this.consumerReady = this.worker.isRunning();

    if (
      shouldScheduleDemoJob(
        this.config.get('APP_ENV', { infer: true }),
        this.config.get('DEMO_JOB_ENABLED', { infer: true }),
      )
    ) {
      await this.queue.add(
        DEMO_JOB_NAME,
        { requestedAt: new Date().toISOString() },
        { jobId: 'stage-zero-demo-health' },
      );
    }
  }

  async check(): Promise<HealthDependency> {
    const startedAt = performance.now();
    const timeout = this.config.get('BULLMQ_READY_TIMEOUT_MS', { infer: true });
    const [producer, consumer] = await Promise.allSettled([
      withTimeout(
        this.queue.getJobCounts('active', 'waiting', 'failed'),
        timeout,
        'BullMQ producer check',
      ),
      withTimeout(this.worker.waitUntilReady(), timeout, 'BullMQ consumer check'),
    ]);

    assertBullMqReadiness({
      consumerReady:
        !this.shuttingDown &&
        consumer.status === 'fulfilled' &&
        this.consumerReady &&
        this.consumerError === undefined &&
        this.worker.isRunning(),
      producerReady: producer.status === 'fulfilled',
    });

    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: 'up',
    };
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    this.consumerReady = false;
    const timeout = this.config.get('WORKER_SHUTDOWN_TIMEOUT_MS', { infer: true });

    try {
      await withTimeout(
        Promise.all([this.worker.close(), this.queue.close()]),
        timeout,
        'BullMQ graceful shutdown',
      );
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'BullMQ graceful shutdown failed');

      const forceTimeout = Math.min(timeout, 1_000);
      try {
        await withTimeout(
          Promise.allSettled([this.worker.close(true), this.queue.disconnect()]),
          forceTimeout,
          'BullMQ forced shutdown',
        );
      } catch (forceError) {
        this.logger.error(
          forceError instanceof Error ? forceError.message : 'BullMQ forced shutdown failed',
        );
      }
    }
  }
}
