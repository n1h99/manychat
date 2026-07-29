import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CrmIntegrationController } from './crm-integration.controller';
import { CrmMediaUploadDto } from './dto';

describe('CrmIntegrationController DTO metadata', () => {
  it('preserves the multipart media DTO as a runtime class', () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      CrmIntegrationController.prototype,
      'uploadMedia',
    ) as unknown[];

    expect(parameterTypes[0]).toBe(CrmMediaUploadDto);
    expect(
      validateSync(
        plainToInstance(CrmMediaUploadDto, {
          crmProjectId: 'cyber-pulse-staging',
          kind: 'DOCUMENT',
          omnicusProjectId: '5389d6fd-ad17-44d6-a430-a4e0c1cb6d3f',
        }),
      ),
    ).toHaveLength(0);
  });
});
