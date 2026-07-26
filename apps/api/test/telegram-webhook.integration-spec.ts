import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { configureApiApplication } from '../src/platform/configure-api-application';
import { CorrelationIdMiddleware } from '../src/platform/correlation-id.middleware';
import { TelegramWebhookController } from '../src/telegram-webhook/telegram-webhook.controller';
import { TelegramWebhookService } from '../src/telegram-webhook/telegram-webhook.service';

const receive = jest.fn();

@Module({
  controllers: [TelegramWebhookController],
  providers: [{ provide: TelegramWebhookService, useValue: { receive } }],
})
class TelegramWebhookTestModule {}

function applyCorrelationMiddleware(app: { use: (middleware: unknown) => unknown }): void {
  const correlation = new CorrelationIdMiddleware();
  app.use((requestValue: Request, responseValue: Response, next: NextFunction) =>
    correlation.use(requestValue, responseValue, next),
  );
}

describe('Telegram webhook endpoint (integration)', () => {
  it('is public, preserves correlation ID, and returns no persisted identifiers', async () => {
    receive.mockResolvedValueOnce({ accepted: true, duplicate: false });
    const module = await Test.createTestingModule({
      imports: [TelegramWebhookTestModule],
    }).compile();
    const app = module.createNestApplication();
    applyCorrelationMiddleware(app);
    configureApiApplication(app, { swaggerEnabled: false });
    await app.init();

    const response = await request(app.getHttpServer())
      .post('/webhooks/telegram/connection-a')
      .set('x-correlation-id', 'telegram-correlation')
      .set('x-telegram-bot-api-secret-token', 'never-returned')
      .send({ update_id: 7 })
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('telegram-correlation');
    expect(response.body).toEqual({ ok: true });
    expect(JSON.stringify(response.body)).not.toContain('connection-a');
    expect(receive).toHaveBeenCalledWith(
      'connection-a',
      'never-returned',
      { update_id: 7 },
      expect.objectContaining({ correlationId: 'telegram-correlation' }),
    );
    await app.close();
  });

  it('returns a safe 401 envelope when the secret is rejected', async () => {
    receive.mockResolvedValueOnce({ accepted: false, duplicate: false });
    const module = await Test.createTestingModule({
      imports: [TelegramWebhookTestModule],
    }).compile();
    const app = module.createNestApplication();
    applyCorrelationMiddleware(app);
    configureApiApplication(app, { swaggerEnabled: false });
    await app.init();

    const response = await request(app.getHttpServer())
      .post('/webhooks/telegram/connection-a')
      .set('x-telegram-bot-api-secret-token', 'wrong-secret')
      .send({ update_id: 8, text: 'must not be returned' })
      .expect(401);

    expect(JSON.stringify(response.body)).not.toContain('wrong-secret');
    expect(JSON.stringify(response.body)).not.toContain('must not be returned');
    expect(response.body.error).toMatchObject({ code: 'WEBHOOK_SECRET_REJECTED' });
    await app.close();
  });
});
