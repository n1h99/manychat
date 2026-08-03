import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export type WhatsAppTemplateStatus =
  'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'UNKNOWN';

export type WhatsAppTemplateCategory = 'AUTHENTICATION' | 'MARKETING' | 'UTILITY' | 'UNKNOWN';

export type WhatsAppTemplateQuality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export interface WhatsAppTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  text?: string;
  buttons?: Array<{
    dynamic?: boolean;
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
  }>;
}

export interface WhatsAppMessageTemplate {
  id: string;
  name: string;
  languageCode: string;
  status: WhatsAppTemplateStatus;
  category: WhatsAppTemplateCategory;
  quality: WhatsAppTemplateQuality;
  components: WhatsAppTemplateComponent[];
  rejectionReasonCode: string | null;
  lastSyncedAt: string;
}

export type WhatsAppTemplateParameter =
  | { text: string; type: 'text' }
  | { amount1000: number; code: string; fallbackValue: string; type: 'currency' }
  | { fallbackValue: string; type: 'date_time' }
  | { mediaAssetId: string; type: 'document' | 'image' | 'video' }
  | { payload: string; type: 'payload' };

export type WhatsAppTemplateComponentInput =
  | { parameters: WhatsAppTemplateParameter[]; type: 'body' | 'header' }
  | {
      index: number;
      parameters: WhatsAppTemplateParameter[];
      subType: 'quick_reply' | 'url';
      type: 'button';
    };

export function useWhatsAppTemplates(projectId?: string, connectionId?: string, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId && connectionId && enabled),
    queryFn: () =>
      apiRequest<WhatsAppMessageTemplate[]>(
        `/api/v1/projects/${projectId}/channels/${connectionId}/whatsapp/templates`,
        {},
        accessToken,
      ),
    queryKey: ['whatsapp-templates', projectId, connectionId],
  });
}

export function useWhatsAppTemplateMutations(projectId?: string, connectionId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return {
    sync: useMutation({
      mutationFn: () =>
        apiRequest<WhatsAppMessageTemplate[]>(
          `/api/v1/projects/${projectId}/channels/${connectionId}/whatsapp/templates/sync`,
          { method: 'POST' },
          accessToken,
        ),
      onSuccess: (templates) => {
        client.setQueryData(['whatsapp-templates', projectId, connectionId], templates);
      },
    }),
  };
}
