import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApiApplication } from '../src/platform/configure-api-application';

describe('API health (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApiApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports process liveness without contacting dependencies', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-correlation-id', 'integration-check')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('integration-check');
    expect(response.body).toMatchObject({
      data: {
        service: 'api',
        status: 'live',
      },
      meta: {},
    });
  });

  it('returns structured errors with a correlation ID', async () => {
    const response = await request(app.getHttpServer()).get('/not-found').expect(404);

    expect(response.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        correlationId: expect.any(String),
        details: null,
      },
    });
  });
});
