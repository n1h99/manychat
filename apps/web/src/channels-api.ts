import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api';
import { useAuth } from './auth';

export interface Channel {
  id: string;
  projectId: string;
  type: 'TELEGRAM';
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'ERROR';
  botUsername: string | null;
  externalBotId: string | null;
  maskedToken: string | null;
  webhookStatus: string;
  webhookUrl?: string;
  lastWebhookAt: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}
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
type CreateInput = { name: string; botToken: string };
type UpdateInput = { name?: string; botToken?: string };
type MessageInput = {
  contactId?: string;
  channelIdentityId?: string;
  text: string;
  idempotencyKey: string;
  disableNotification?: boolean;
  replyToMessageId?: string;
};
export function useChannels(projectId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['channels', projectId],
    enabled: Boolean(projectId),
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
export function useChannelInboundEvents(projectId?: string, id?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && id),
    queryFn: () =>
      apiRequest<ChannelInboundEvent[]>(
        `/api/v1/projects/${projectId}/channels/${id}/inbound-events`,
        {},
        accessToken,
      ),
    queryKey: ['channel-inbound-events', projectId, id],
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
export function useChannelMutations(projectId?: string) {
  const { accessToken } = useAuth();
  const cache = useQueryClient();
  const invalidate = () => cache.invalidateQueries({ queryKey: ['channels', projectId] });
  const request = <T>(path: string, method: string, body?: unknown) =>
    apiRequest<T>(
      `/api/v1/projects/${projectId}/channels${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      accessToken,
    );
  return {
    create: useMutation({
      mutationFn: (input: CreateInput) => request<Channel>('', 'POST', input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & UpdateInput) =>
        request<Channel>(`/${id}`, 'PATCH', input),
      onSuccess: invalidate,
    }),
    test: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/test`, 'POST'),
      onSuccess: invalidate,
    }),
    connect: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/connect`, 'POST', {}),
      onSuccess: invalidate,
    }),
    disable: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/disable`, 'POST'),
      onSuccess: invalidate,
    }),
    rotate: useMutation({
      mutationFn: (id: string) => request<Channel>(`/${id}/rotate-secret`, 'POST'),
      onSuccess: invalidate,
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
