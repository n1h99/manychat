import { ConfigService } from '@nestjs/config';
import { validateWorkerEnvironment, type WorkerEnvironment } from '@omnicus/config/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DemoQueueService } from './demo-queue.service';

const integrationDescribe =
  process.env.RUN_SERVICE_INTEGRATION === 'true' ? describe : describe.skip;

integrationDescribe('DemoQueueService integration', () => {
  let service: DemoQueueService;

  beforeAll(async () => {
    const environment = validateWorkerEnvironment({
      ...process.env,
      APP_ENV: 'test',
      DEMO_JOB_ENABLED: 'false',
      NODE_ENV: 'test',
    });
    const config = new ConfigService<WorkerEnvironment, true>(environment);
    service = new DemoQueueService(config);
    await service.onApplicationBootstrap();
  });

  afterAll(async () => {
    await service.onApplicationShutdown();
  });

  it('requires a live producer and a running consumer', async () => {
    await expect(service.check()).resolves.toMatchObject({
      status: 'up',
    });
  });
});
