import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './api';
import { useAuth } from './auth';

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  source: 'TELEGRAM' | 'USER_UPLOAD';
  status: string;
  originalFilename: string | null;
  detectedMimeType: string | null;
  sizeBytes: string | null;
  createdAt: string;
}

export type MediaKind =
  'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE';

export function useMediaAssets(projectId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<MediaAsset[]>(`/api/v1/projects/${projectId}/media-assets`, {}, accessToken),
    queryKey: ['media-assets', projectId],
  });
}

export function useMediaMutations(projectId?: string) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['media-assets', projectId] });
  return {
    materialize: useMutation({
      mutationFn: (assetId: string) =>
        apiRequest<MediaAsset>(
          `/api/v1/projects/${projectId}/media-assets/${assetId}/materialize`,
          { method: 'POST' },
          accessToken,
        ),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (assetId: string) =>
        apiRequest<{ deleted: boolean }>(
          `/api/v1/projects/${projectId}/media-assets/${assetId}`,
          { method: 'DELETE' },
          accessToken,
        ),
      onSuccess: invalidate,
    }),
    signedUrl: useMutation({
      mutationFn: (assetId: string) =>
        apiRequest<{ expiresInSeconds: number; url: string }>(
          `/api/v1/projects/${projectId}/media-assets/${assetId}/url`,
          {},
          accessToken,
        ),
    }),
    upload: useMutation({
      mutationFn: ({ file, kind }: { file: File; kind: MediaKind }) => {
        const body = new FormData();
        body.set('file', file);
        return apiRequest<MediaAsset>(
          `/api/v1/projects/${projectId}/media-assets/upload/${kind}`,
          { body, method: 'POST' },
          accessToken,
        );
      },
      onSuccess: invalidate,
    }),
  };
}
