import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ContactsController } from './contacts.controller';
import { AddTagDto, BulkTagsDto, ContactsQueryDto } from './dto';

function parameterTypes(method: keyof ContactsController): unknown[] {
  return Reflect.getMetadata(
    'design:paramtypes',
    ContactsController.prototype,
    method,
  ) as unknown[];
}

describe('ContactsController DTO metadata', () => {
  it('preserves the query DTO at runtime so validation supplies pagination defaults', () => {
    expect(parameterTypes('list')[1]).toBe(ContactsQueryDto);

    const query = plainToInstance(ContactsQueryDto, {});
    expect(query).toMatchObject({
      page: 1,
      pageSize: 25,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
    expect(validateSync(query)).toHaveLength(0);
  });

  it('accepts every contact status exposed by the list UI', () => {
    for (const status of ['ACTIVE', 'BLOCKED', 'UNSUBSCRIBED', 'ARCHIVED', 'MERGED']) {
      expect(validateSync(plainToInstance(ContactsQueryDto, { status }))).toHaveLength(0);
    }
  });

  it('preserves contact tag DTOs at runtime for request validation', () => {
    expect(parameterTypes('addTag')[2]).toBe(AddTagDto);
    expect(parameterTypes('bulkTags')[1]).toBe(BulkTagsDto);
  });
});
