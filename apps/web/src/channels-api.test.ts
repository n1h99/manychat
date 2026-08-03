import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { type Channel, syncChannelCache } from './channels-api';

function channel(status: Channel['status'], webhookStatus: string): Channel {
  return {
    botUsername: 'omnicus_test_bot',
    createdAt: '2026-08-02T00:00:00.000Z',
    externalBotId: 'bot-1',
    id: 'connection-1',
    lastErrorAt: null,
    lastWebhookAt: null,
    maskedToken: '1234:***',
    name: 'Telegram',
    projectId: 'project-1',
    status,
    type: 'TELEGRAM',
    updatedAt: '2026-08-02T01:00:00.000Z',
    webhookStatus,
  };
}

describe('channel mutation cache synchronization', () => {
  it('updates the active detail and list immediately after disabling a channel', async () => {
    const cache = new QueryClient();
    const active = channel('ACTIVE', 'CONNECTED');
    const disabled = channel('DISABLED', 'NOT_CONNECTED');
    cache.setQueryData(['channels', 'project-1'], [active]);
    cache.setQueryData(['channel', 'project-1', active.id], active);

    await syncChannelCache(cache, 'project-1', disabled);

    expect(cache.getQueryData(['channel', 'project-1', active.id])).toEqual(disabled);
    expect(cache.getQueryData<Channel[]>(['channels', 'project-1'])).toEqual([disabled]);
    expect(cache.getQueryState(['channel', 'project-1', active.id])?.isInvalidated).toBe(true);
    expect(cache.getQueryState(['channels', 'project-1'])?.isInvalidated).toBe(true);
  });

  it('restores the connected state in the same cache entry', async () => {
    const cache = new QueryClient();
    const disabled = channel('DISABLED', 'NOT_CONNECTED');
    const connected = channel('ACTIVE', 'CONNECTED');
    cache.setQueryData(['channels', 'project-1'], [disabled]);
    cache.setQueryData(['channel', 'project-1', disabled.id], disabled);

    await syncChannelCache(cache, 'project-1', connected);

    expect(cache.getQueryData(['channel', 'project-1', disabled.id])).toEqual(connected);
    expect(cache.getQueryData<Channel[]>(['channels', 'project-1'])).toEqual([connected]);
  });

  it('adds a newly created channel to an already loaded list without a reload', async () => {
    const cache = new QueryClient();
    const first = channel('ACTIVE', 'CONNECTED');
    const created = { ...channel('DRAFT', 'NOT_CONNECTED'), id: 'connection-2' };
    cache.setQueryData(['channels', 'project-1'], [first]);

    await syncChannelCache(cache, 'project-1', created);

    expect(cache.getQueryData<Channel[]>(['channels', 'project-1'])).toEqual([created, first]);
    expect(cache.getQueryData(['channel', 'project-1', created.id])).toEqual(created);
  });
});
