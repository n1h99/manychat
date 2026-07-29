import { Button, Modal, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { useState } from 'react';
import { useParams } from 'react-router';

import { type MediaAsset, type MediaKind, useMediaAssets, useMediaMutations } from '../media-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function MediaAssetsPage() {
  const { projectId } = useParams();
  const assets = useMediaAssets(projectId);
  const mutations = useMediaMutations(projectId);
  const access = useProjectAccess(projectId);
  const canManage = hasProjectPermission(access.data, 'media:manage');
  const [file, setFile] = useState<File>();
  const [kind, setKind] = useState<MediaKind>('PHOTO');
  const upload = async () => {
    if (!file) return;
    try {
      await mutations.upload.mutateAsync({ file, kind });
      setFile(undefined);
      void message.success('Media asset uploaded.');
    } catch {
      void message.error(
        'Upload failed. Make sure the image, PDF or ZIP is complete, uses the selected format and is within the upload limit.',
      );
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div>
          <Typography.Text className="header-kicker">Content library</Typography.Text>
          <Typography.Title level={2}>Media assets</Typography.Title>
          <Typography.Text type="secondary">
            Validated private files for Telegram templates and automated messages.
          </Typography.Text>
        </div>
      </div>
      {canManage ? (
        <Space className="media-upload-panel surface" wrap>
          <Select
            onChange={setKind}
            options={[
              { label: 'Photo (JPEG/PNG/WebP)', value: 'PHOTO' },
              { label: 'Document (PDF/ZIP)', value: 'DOCUMENT' },
              { label: 'Video (MP4)', value: 'VIDEO' },
              { label: 'Audio (MP3/M4A)', value: 'AUDIO' },
              { label: 'Voice (OGG/MP3/M4A)', value: 'VOICE' },
              { label: 'Video note (square MP4)', value: 'VIDEO_NOTE' },
              { label: 'Animation (GIF/MP4)', value: 'ANIMATION' },
            ]}
            value={kind}
          />
          <Upload
            accept={
              kind === 'PHOTO'
                ? '.jpg,.jpeg,.png,.webp'
                : kind === 'DOCUMENT'
                  ? '.pdf,.zip'
                  : kind === 'VOICE'
                    ? '.ogg,.mp3,.m4a,.mp4'
                    : kind === 'AUDIO'
                      ? '.mp3,.m4a,.mp4'
                      : kind === 'ANIMATION'
                        ? '.gif,.mp4'
                        : '.mp4'
            }
            beforeUpload={(next) => {
              setFile(next);
              return false;
            }}
            fileList={file ? [{ name: file.name, status: 'done', uid: file.name }] : []}
            maxCount={1}
            onRemove={() => {
              setFile(undefined);
            }}
          >
            <Button>Select file</Button>
          </Upload>
          <Button
            disabled={!file}
            loading={mutations.upload.isPending}
            onClick={() => void upload()}
            type="primary"
          >
            Upload
          </Button>
        </Space>
      ) : null}
      <Table<MediaAsset>
        dataSource={assets.data ?? []}
        loading={assets.isLoading}
        rowKey="id"
        columns={[
          { dataIndex: 'originalFilename', title: 'File', render: (value) => value ?? 'Telegram' },
          { dataIndex: 'kind', title: 'Kind' },
          { dataIndex: 'source', title: 'Source' },
          { dataIndex: 'status', title: 'Status', render: (value) => <Tag>{value}</Tag> },
          {
            dataIndex: 'sizeBytes',
            title: 'Size',
            render: (value) => (value ? `${Math.ceil(Number(value) / 1024)} KB` : '—'),
          },
          {
            key: 'actions',
            render: (_, asset) => (
              <Space>
                {asset.status === 'AVAILABLE' ? (
                  <Button
                    onClick={async () => {
                      const result = await mutations.signedUrl.mutateAsync(asset.id);
                      window.open(result.url, '_blank', 'noopener,noreferrer');
                    }}
                    size="small"
                  >
                    Open
                  </Button>
                ) : null}
                {canManage && asset.status === 'PROVIDER_REFERENCE' ? (
                  <Button
                    loading={mutations.materialize.isPending}
                    onClick={() => void mutations.materialize.mutateAsync(asset.id)}
                    size="small"
                  >
                    Download from Telegram
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    danger
                    onClick={() =>
                      Modal.confirm({
                        onOk: () => mutations.remove.mutateAsync(asset.id),
                        title: 'Delete this media asset?',
                      })
                    }
                    size="small"
                  >
                    Delete
                  </Button>
                ) : null}
              </Space>
            ),
            title: 'Actions',
          },
        ]}
      />
    </section>
  );
}
