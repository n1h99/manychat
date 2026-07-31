import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export type TemplateKind =
  'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'TEXT' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE';
export interface TelegramInlineKeyboardButton {
  callbackData?: string;
  text: string;
  url?: string;
}
export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];
export interface TemplateVersion {
  content: {
    caption?: string;
    inlineKeyboard?: TelegramInlineKeyboard;
    text?: string;
  };
  id: string;
  kind: TemplateKind;
  inlineKeyboard?: TelegramInlineKeyboard;
  mediaAssetId: string | null;
  status: string;
  variables: string[];
  version: number;
}
export interface MessageTemplate {
  activeVersion: TemplateVersion | null;
  activeVersionId: string | null;
  description: string | null;
  draftVersion: TemplateVersion | null;
  id: string;
  name: string;
  status: string;
  versions?: TemplateVersion[];
}
export interface TemplateInput {
  caption?: string;
  description?: string;
  kind: TemplateKind;
  mediaAssetId?: string;
  name: string;
  text?: string;
}

export function useTemplates(projectId?: string, archived = false) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<MessageTemplate[]>(
        `/api/v1/projects/${projectId}/templates?archived=${archived}`,
        {},
        accessToken,
      ),
    queryKey: ['templates', projectId, archived],
  });
}

export function useTemplate(projectId?: string, templateId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && templateId),
    queryFn: () =>
      apiRequest<MessageTemplate>(
        `/api/v1/projects/${projectId}/templates/${templateId}`,
        {},
        accessToken,
      ),
    queryKey: ['template', projectId, templateId],
  });
}

export function useTemplateMutations(projectId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['templates', projectId] });
    await client.invalidateQueries({ queryKey: ['template', projectId] });
  };
  const request = <T>(path: string, method: string, body?: unknown) =>
    apiRequest<T>(
      `/api/v1/projects/${projectId}/templates${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      accessToken,
    );
  return {
    archive: useMutation({
      mutationFn: (id: string) => request<MessageTemplate>(`/${id}/archive`, 'POST'),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (id: string) => request<MessageTemplate>(`/${id}/restore`, 'POST'),
      onSuccess: invalidate,
    }),
    create: useMutation({
      mutationFn: (input: TemplateInput) => request<MessageTemplate>('', 'POST', input),
      onSuccess: invalidate,
    }),
    preview: useMutation({
      mutationFn: ({ id, variables }: { id: string; variables: Record<string, unknown> }) =>
        request<{ kind: TemplateKind; missing: string[]; output: string }>(
          `/${id}/preview`,
          'POST',
          { variables },
        ),
    }),
    publish: useMutation({
      mutationFn: (id: string) => request<MessageTemplate>(`/${id}/publish`, 'POST'),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: Partial<TemplateInput> & { id: string }) =>
        request<MessageTemplate>(`/${id}`, 'PATCH', input),
      onSuccess: invalidate,
    }),
  };
}
