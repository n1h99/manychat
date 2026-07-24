import 'reflect-metadata';

import {
  Controller,
  Get,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApiApplication } from '../src/platform/configure-api-application';

@Controller('__stage-zero-test')
class FailingController {
  @Get('failure')
  fail(): never {
    throw new Error('sensitive internal failure');
  }

  @Get('dependency-failure')
  dependencyFailure(): never {
    throw new ServiceUnavailableException(
      {
        code: 'UNSAFE_UPSTREAM_CODE',
        details: { databasePassword: 'must-not-leak' },
        message: 'sensitive upstream failure',
      },
      { cause: new Error('private dependency error') },
    );
  }
}

describe('API health (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FailingController],
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApiApplication(app, { swaggerEnabled: false });
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
    expect(response.headers['x-content-type-options']).toBe('nosniff');
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

  const dependencyTest =
    process.env.RUN_SERVICE_INTEGRATION === 'true' ? it : process.env.CI === 'true' ? it : it.skip;

  dependencyTest('reports ready when PostgreSQL and Redis are reachable', async () => {
    if (process.env.RUN_SERVICE_INTEGRATION !== 'true') {
      throw new Error(
        'RUN_SERVICE_INTEGRATION=true is required for the CI service integration suite',
      );
    }
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(response.body).toMatchObject({
      data: {
        dependencies: {
          database: { status: 'up' },
          redis: { status: 'up' },
        },
        status: 'ready',
      },
    });
  });

  it('does not expose internal details for a 5xx response', async () => {
    const response = await request(app.getHttpServer())
      .get('/__stage-zero-test/failure')
      .set('x-correlation-id', 'failure-check')
      .expect(500);

    expect(JSON.stringify(response.body)).not.toContain('sensitive internal failure');
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        correlationId: 'failure-check',
        details: null,
        message: 'An internal error occurred',
      },
    });
  });

  it('uses the fixed safe envelope for an explicit 503 response', async () => {
    const response = await request(app.getHttpServer())
      .get('/__stage-zero-test/dependency-failure')
      .set('x-correlation-id', 'dependency-failure-check')
      .expect(503);

    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
    expect(response.body).toEqual({
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        correlationId: 'dependency-failure-check',
        details: null,
        message: 'Service temporarily unavailable',
      },
    });
  });
});
