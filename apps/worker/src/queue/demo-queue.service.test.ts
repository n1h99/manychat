import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { validateWorkerEnvironment, type WorkerEnvironment } from '@omnicus/config/server';
import { describe, expect, it } from 'vitest';

import { WorkerHealthController } from '../worker-health.controller';
import {
  type DemoQueueClients,
  type DemoQueueConsumer,
  type DemoQueueProducer,
  DemoQueueService,
} from './demo-queue.service';

class FakeProducer implements DemoQueueProducer {
  failChecks = false;
  disconnectCalls = 0;
  closeCalls = 0;
  closeNeverResolves = false;

  async add(): Promise<unknown> {
    return undefined;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeNeverResolves) {
      return new Promise<void>(() => undefined);
    }
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  async getJobCounts(): Promise<unknown> {
    if (this.failChecks) {
      throw new Error('producer unavailable');
    }
    return { active: 0, failed: 0, waiting: 0 };
  }

  async waitUntilReady(): Promise<void> {
    if (this.failChecks) {
      throw new Error('producer unavailable');
    }
  }
}

class FakeConsumer implements DemoQueueConsumer {
  running = true;
  failChecks = false;
  closeCalls = 0;
  closeNeverResolves = false;
  private closedListener: (() => void) | undefined;
  private errorListener: ((error: Error) => void) | undefined;
  private readyListener: (() => void) | undefined;

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeNeverResolves && this.closeCalls === 1) {
      return new Promise<void>(() => undefined);
    }
  }

  emitClosed(): void {
    this.closedListener?.();
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }

  emitReady(): void {
    this.readyListener?.();
  }

  isRunning(): boolean {
    return this.running;
  }

  on(event: 'closed' | 'ready', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'closed' | 'error' | 'ready',
    listener: (() => void) | ((error: Error) => void),
  ): unknown {
    if (event === 'closed') {
      this.closedListener = listener as () => void;
    } else if (event === 'error') {
      this.errorListener = listener as (error: Error) => void;
    } else {
      this.readyListener = listener as () => void;
    }
    return this;
  }

  async waitUntilReady(): Promise<void> {
    if (this.failChecks) {
      throw new Error('consumer unavailable');
    }
  }
}

function createService(): {
  consumer: FakeConsumer;
  producer: FakeProducer;
  service: DemoQueueService;
} {
  const environment = validateWorkerEnvironment({
    APP_ENV: 'test',
    BULLMQ_READY_TIMEOUT_MS: '250',
    DATABASE_URL: 'postgresql://omnicus:omnicus@localhost:5432/omnicus',
    DEMO_JOB_ENABLED: 'false',
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379/0',
    WORKER_SHUTDOWN_TIMEOUT_MS: '250',
  });
  const producer = new FakeProducer();
  const consumer = new FakeConsumer();
  const clients: DemoQueueClients = { consumer, producer };
  const config = new ConfigService<WorkerEnvironment, true>(environment);
  return { consumer, producer, service: new DemoQueueService(config, clients) };
}

describe('DemoQueueService readiness', () => {
  it('requires both a ready producer and a running consumer', async () => {
    const { service } = createService();
    await service.onApplicationBootstrap();
    await expect(service.check()).resolves.toMatchObject({ status: 'up' });
  });

  it('fails readiness when producer checks fail', async () => {
    const { producer, service } = createService();
    await service.onApplicationBootstrap();
    producer.failChecks = true;
    await expect(service.check()).rejects.toThrow(/producer=false/);
  });

  it('fails readiness when consumer checks fail', async () => {
    const { consumer, service } = createService();
    await service.onApplicationBootstrap();
    consumer.failChecks = true;
    await expect(service.check()).rejects.toThrow(/consumer=false/);
  });

  it('fails readiness after a consumer error or close event', async () => {
    const first = createService();
    await first.service.onApplicationBootstrap();
    first.consumer.emitError(new Error('consumer process failed'));
    await expect(first.service.check()).rejects.toThrow(/consumer=false/);

    const second = createService();
    await second.service.onApplicationBootstrap();
    second.consumer.emitClosed();
    await expect(second.service.check()).rejects.toThrow(/consumer=false/);
  });

  it('fails readiness when the consumer is no longer running', async () => {
    const { consumer, service } = createService();
    await service.onApplicationBootstrap();
    consumer.running = false;
    await expect(service.check()).rejects.toThrow(/consumer=false/);
  });

  it('maps an unavailable queue dependency to HTTP 503', async () => {
    const { producer, service } = createService();
    await service.onApplicationBootstrap();
    producer.failChecks = true;
    const controller = new WorkerHealthController(service);

    try {
      await controller.readiness();
      throw new Error('Expected worker readiness to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      if (error instanceof ServiceUnavailableException) {
        expect(error.getStatus()).toBe(503);
      }
    }
  });

  it('bounds graceful shutdown and then forces the queue clients closed', async () => {
    const { consumer, producer, service } = createService();
    consumer.closeNeverResolves = true;
    producer.closeNeverResolves = true;
    const startedAt = performance.now();

    await service.onApplicationShutdown();

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(consumer.closeCalls).toBe(2);
    expect(producer.closeCalls).toBe(1);
    expect(producer.disconnectCalls).toBe(1);
  });
});
