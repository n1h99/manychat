import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { BroadcastsController } from './broadcasts.controller';
import { BroadcastRecipientsQueryDto } from './dto';

describe('BroadcastsController DTO metadata', () => {
  it('preserves recipient pagination defaults at runtime', () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      BroadcastsController.prototype,
      'recipients',
    ) as unknown[];
    expect(parameterTypes[2]).toBe(BroadcastRecipientsQueryDto);

    const query = plainToInstance(BroadcastRecipientsQueryDto, {});
    expect(query).toMatchObject({ page: 1, pageSize: 50 });
    expect(validateSync(query)).toHaveLength(0);
  });
});
