import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api';
import { useAuth } from './auth';

export type ChannelType = 'TELEGRAM' | 'WHATSAPP';
export type ChannelConnectionStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'ERROR';

interface BaseChannel {
  id: string;
  projectId: string;
  name: string;
  status: ChannelConnectionStatus;
  type: ChannelType;
  webhookStatus: 'CONNECTED' | 'NOT_CONNECTED' | string;
  webhookUrl?: string;
  lastWebhookAt: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramChannel extends BaseChannel {
  type: 'TELEGRAM';
  botUsername: string | null;
  externalBotId: string | null;
  maskedToken: string | null;
}

export type WhatsAppSetupMode = 'MANUAL' | 'EMBEDDED_SIGNUP';

export interface WhatsAppChannel extends BaseChannel {
  type: 'WHATSAPP';
  setupMode: WhatsAppSetupMode;
  setupReady: boolean;
  configured: boolean;
  graphApiVersion: string | null;
  businessAccountId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  maskedToken: string | null;
  missingConfiguration: string[];
}

export type Channel = TelegramChannel | WhatsAppChannel;
type Paged<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
export interface ChannelInboundEvent {
  correlationId: string;
  externalUpdateId: string;
  inboxRecord: {
    attempts: number;
    completedAt: string | null;
    lastError: string | null;
    maxAttempts: number;
    nextAttemptAt: string | null;
    normalizedEvent: {
      createdAt: string;
      message: {
        contactId: string;
        conversationId: string;
        id: string;
        status: string;
      } | null;
      type: string;
    } | null;
    status: string;
  } | null;
  receivedAt: string;
  status: string;
}
export interface ChannelIdentityOption {
  contact: {
    displayName: string;
    id: string;
  };
  displayName: string | null;
  externalUserId: string;
  id: string;
  status: 'ACTIVE' | 'BLOCKED';
  username: string | null;
}
export interface ChannelOutboundEvent {
  attempts: number;
  completedAt: string | null;
  createdAt: string;
  id: string;
  lastError: string | null;
  maxAttempts: number;
  message: {
    externalMessageId: string | null;
    failedAt: string | null;
    id: string;
    sentAt: string | null;
    status: string;
    type: string;
  } | null;
  nextAttemptAt: string | null;
  status: string;
  updatedAt: string;
}
export type CreateChannelInput =
  | { type: 'TELEGRAM'; name: string; botToken: string }
  | ({ type: 'WHATSAPP'; name: string } & WhatsAppConfigurationInput);

export type WhatsAppConfigurationInput = {
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  graphApiVersion?: string;
};

export interface WhatsAppSetup {
  configured: boolean;
  graphApiVersion: string | null;
  appId: string | null;
  configurationId: string | null;
  missingConfiguration: string[];
  callbackUrl: string;
}

export interface CompleteWhatsAppSetupInput {
  code: string;
  connectionId?: string;
  name: string;
  pin: string;
  phoneNumberId: string;
  wabaId: string;
}

export type UpdateChannelInput =
  | ({ type?: 'TELEGRAM'; name?: string; botToken?: string } & { id: string })
  | ({ type: 'WHATSAPP'; name?: string } & WhatsAppConfigurationInput & { id: string });
type MessageInput = {
  contactId?: string;
  channelIdentityId?: string;
  text: string;
  idempotencyKey: string;
  disableNotification?: boolean;
  replyToMessageId?: string;
};
export function useChannels(projectId?: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['channels', projectId],
    enabled: Boolean(projectId && enabled),
    queryFn: () => apiRequest<Channel[]>(`/api/v1/projects/${projectId}/channels`, {}, accessToken),
  });
}
export function useChannel(projectId?: string, id?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['channel', projectId, id],
    enabled: Boolean(projectId && id),
    queryFn: () =>
      apiRequest<Channel>(`/api/v1/projects/${projectId}/channels/${id}`, {}, accessToken),
  });
}
export function useWhatsAppSetup(projectId?: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && enabled),
    queryFn: () =>
      apiRequest<WhatsAppSetup>(
        `/api/v1/projects/${projectId}/channels/whatsapp/setup`,
        {},
        accessToken,
      ),
    queryKey: ['whatsapp-setup', projectId],
  });
}
function unwrapChannelEvents<T>(payload: T[] | Paged<T>) {
  return Array.isArray(payload) ? payload : payload.items;
}
export function useChannelInboundEvents(projectId?: string, id?: string, page = 1, pageSize = 20) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && id),
    queryFn: () =>
      apiRequest<ChannelInboundEvent[] | Paged<ChannelInboundEvent>>(
        `/api/v1/projects/${projectId}/channels/${id}/inbound-events?page=${page}&pageSize=${pageSize}`,
        {},
        accessToken,
      ),
    queryKey: ['channel-inbound-events', projectId, id, page, pageSize],
    select: unwrapChannelEvents,
    refetchInterval: 10_000,
  });
}
export function useChannelIdentities(projectId?: string, id?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && id),
    queryFn: () =>
      apiRequest<ChannelIdentityOption[]>(
        `/api/v1/projects/${projectId}/channels/${id}/identities`,
        {},
        accessToken,
      ),
    queryKey: ['channel-identities', projectId, id],
  });
}
export function useChannelOutboundEvents(projectId?: string, id?: string, page = 1, pageSize = 20) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && id),
    queryFn: () =>
      apiRequest<ChannelOutboundEvent[] | Paged<ChannelOutboundEvent>>(
        `/api/v1/projects/${projectId}/channels/${id}/outbound-events?page=${page}&pageSize=${pageSize}`,
        {},
        accessToken,
      ),
    queryKey: ['channel-outbound-events', projectId, id, page, pageSize],
    select: unwrapChannelEvents,
    refetchInterval: 5_000,
  });
}

export async function syncChannelCache(
  cache: QueryClient,
  projectId: string | undefined,
  channel: Channel,
) {
  cache.setQueryData<Channel[]>(['channels', projectId], (channels) => {
    if (!channels) return [channel];
    return channels.some((candidate) => candidate.id === channel.id)
      ? channels.map((candidate) => (candidate.id === channel.id ? channel : candidate))
      : [channel, ...channels];
  });
  cache.setQueryData(['channel', projectId, channel.id], channel);

  await Promise.all([
    cache.invalidateQueries({ queryKey: ['channels', projectId] }),
    cache.invalidateQueries({
      exact: true,
      queryKey: ['channel', projectId, channel.id],
    }),
  ]);
}

export function useChannelMutations(projectId?: string) {
  const { accessToken } = useAuth();
  const cache = useQueryClient();
  const synchronize = (channel: Channel) => syncChannelCache(cache, projectId, channel);
  const refresh = (id: string) =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ['channels', projectId] }),
      cache.invalidateQueries({
        exact: true,
        queryKey: ['channel', projectId, id],
      }),
    ]);
  const request = <T>(path: string, method: string, body?: unknown) =>
    apiRequest<T>(
      `/api/v1/projects/${projectId}/channels${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      accessToken,
    );
  return {
    create: useMutation({
      mutationFn: (input: CreateChannelInput) => request<Channel>('', 'POST', input),
      onSuccess: synchronize,
    }),
    completeWhatsAppSetup: useMutation({
      mutationFn: (input: CompleteWhatsAppSetupInput) =>
        request<Channel>('/whatsapp/setup/complete', 'POST', input),
      onSuccess: synchronize,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: UpdateChannelInput) =>
        request<Channel>(`/${id}`, 'PATCH', input),
      onError: (_error, input) => refresh(input.id),
      onSuccess: synchronize,
    }),
    test: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/test`, 'POST'),
      onError: (_error, id) => refresh(id),
      onSuccess: synchronize,
    }),
    connect: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/connect`, 'POST', {}),
      onError: (_error, id) => refresh(id),
      onSuccess: synchronize,
    }),
    disable: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/disable`, 'POST'),
      onSuccess: synchronize,
    }),
    rotate: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/rotate-secret`, 'POST'),
      onError: (_error, id) => refresh(id),
      onSuccess: synchronize,
    }),
    send: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & MessageInput) =>
        request<{ messageId: string; outboxRecordId: string }>(
          `/${id}/test-message`,
          'POST',
          input,
        ),
    }),
  };
}
