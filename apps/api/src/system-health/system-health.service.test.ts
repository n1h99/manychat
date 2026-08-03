import { describe, expect, it, vi } from 'vitest';

import { SystemHealthService } from './system-health.service';

describe('SystemHealthService operation windows', () => {
  it('separates recent alerts from older terminal records by project', async () => {
    const inboxGroupBy = vi
      .fn()
      .mockResolvedValueOnce([{ _count: { _all: 4 }, projectId: 'project-a', status: 'FAILED' }])
      .mockResolvedValueOnce([{ _count: { _all: 1 }, projectId: 'project-a', status: 'FAILED' }]);
    const outboxGroupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { _count: { _all: 7 }, projectId: 'project-a', status: 'FAILED' },
        { _count: { _all: 2 }, projectId: 'project-b', status: 'UNKNOWN' },
      ])
      .mockResolvedValueOnce([{ _count: { _all: 2 }, projectId: 'project-a', status: 'FAILED' }]);
    const service = new SystemHealthService(
      {} as never,
      {} as never,
      {
        client: {
          auditLog: { findMany: vi.fn().mockResolvedValue([]) },
          channelConnection: { count: vi.fn().mockResolvedValue(0) },
          crmProjectConfig: { count: vi.fn().mockResolvedValue(0) },
          inboxRecord: { groupBy: inboxGroupBy },
          outboxRecord: { groupBy: outboxGroupBy },
          project: {
            findMany: vi.fn().mockResolvedValue([
              { id: 'project-a', name: 'Alpha' },
              { id: 'project-b', name: 'Beta' },
            ]),
          },
        },
      } as never,
      {} as never,
    );

    const aggregates = await (
      service as unknown as {
        safeAggregates(): Promise<{
          inboxTerminal: number;
          operationHistory: {
            older: { inboxTerminal: number; outboxFailed: number; outboxUnknown: number };
            projects: Array<{
              olderFailed: number;
              olderUnknown: number;
              projectName: string;
              recentFailed: number;
            }>;
            recent: { inboxTerminal: number; outboxFailed: number; outboxUnknown: number };
          };
          outboxFailed: number;
          outboxUnknown: number;
        }>;
      }
    ).safeAggregates();

    expect(aggregates).toMatchObject({
      inboxTerminal: 1,
      operationHistory: {
        older: { inboxTerminal: 3, outboxFailed: 5, outboxUnknown: 2 },
        recent: { inboxTerminal: 1, outboxFailed: 2, outboxUnknown: 0 },
      },
      outboxFailed: 2,
      outboxUnknown: 0,
    });
    expect(aggregates.operationHistory.projects).toEqual([
      expect.objectContaining({
        olderFailed: 5,
        olderUnknown: 0,
        projectName: 'Alpha',
        recentFailed: 2,
      }),
      expect.objectContaining({
        olderFailed: 0,
        olderUnknown: 2,
        projectName: 'Beta',
        recentFailed: 0,
      }),
    ]);
  });
});
