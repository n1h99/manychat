import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { MediaRetentionService } from './media-retention.service';

describe('MediaRetentionService', () => {
  it('deletes only the bounded expired asset selection and marks it terminal', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { bucketKey: 'project-a/asset-a.pdf', id: 'asset-a', projectId: 'project-a' },
      ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new MediaRetentionService(
      new ConfigService({
        MEDIA_RETENTION_BATCH_SIZE: 10,
        MEDIA_RETENTION_INTERVAL_MS: 60_000,
        MEDIA_STORAGE_ENABLED: false,
      }) as never,
      { client: { mediaAsset: { findMany, updateMany } } } as never,
    );
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { storage: { deleteObject } });
    const now = new Date('2026-07-27T00:00:00.000Z');

    await expect(service.scanOnce(now)).resolves.toBe(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        where: expect.objectContaining({
          retentionUntil: { lte: now },
          templateVersions: { none: { status: { in: ['PUBLISHED', 'SUPERSEDED'] } } },
        }),
      }),
    );
    expect(deleteObject).toHaveBeenCalledWith('project-a/asset-a.pdf');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELETED' }) }),
    );
  });
});
