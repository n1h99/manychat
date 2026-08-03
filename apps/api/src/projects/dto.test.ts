import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateProjectDto, UpdateProjectDto } from './dto';

describe('project description DTOs', () => {
  it('accepts an empty description as an intentional clear', async () => {
    const update = plainToInstance(UpdateProjectDto, { description: '' });
    expect(await validate(update)).toEqual([]);
    expect(update.description).toBeNull();
  });

  it('accepts an omitted description during project creation', async () => {
    const create = plainToInstance(CreateProjectDto, {
      locale: 'en',
      name: 'Project',
      slug: 'project',
      timezone: 'UTC',
    });
    expect(await validate(create)).toEqual([]);
  });
});
