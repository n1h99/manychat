import { DeleteOutlined, FileOutlined } from '@ant-design/icons';
import { Alert, Button, Modal, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { useState } from 'react';
import { useParams } from 'react-router';

import { getUserErrorMessage } from '../api';
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
    } catch (error) {
      void message.error(getUserErrorMessage(error, 'Media asset could not be uploaded.'));
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div>
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
              { label: 'Sticker (WebP/TGS/WebM)', value: 'STICKER' },
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
                        : kind === 'STICKER'
                          ? '.webp,.tgs,.webm'
                          : '.mp4'
            }
            beforeUpload={(next) => {
              setFile(next);
              return false;
            }}
            maxCount={1}
            showUploadList={false}
          >
            <Button>Select file</Button>
          </Upload>
          {file ? (
            <div className="media-selected-file">
              <FileOutlined />
              <span>{file.name}</span>
              <small>{Math.ceil(file.size / 1024)} KB</small>
              <Button
                aria-label="Remove selected file"
                icon={<DeleteOutlined />}
                onClick={() => setFile(undefined)}
                size="small"
                type="text"
              />
            </div>
          ) : null}
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
      {assets.isError ? (
        <Alert
          message={getUserErrorMessage(assets.error, 'Media assets could not be loaded.')}
          showIcon
          type="error"
        />
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
                      try {
                        const result = await mutations.signedUrl.mutateAsync(asset.id);
                        window.open(result.url, '_blank', 'noopener,noreferrer');
                      } catch (error) {
                        void message.error(
                          getUserErrorMessage(error, 'Media preview could not be opened.'),
                        );
                      }
                    }}
                    size="small"
                  >
                    Open
                  </Button>
                ) : null}
                {canManage && asset.status === 'PROVIDER_REFERENCE' ? (
                  <Button
                    loading={mutations.materialize.isPending}
                    onClick={async () => {
                      try {
                        await mutations.materialize.mutateAsync(asset.id);
                        void message.success('Media downloaded from Telegram.');
                      } catch (error) {
                        void message.error(
                          getUserErrorMessage(
                            error,
                            'Media could not be downloaded from Telegram.',
                          ),
                        );
                      }
                    }}
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
                        onOk: async () => {
                          try {
                            await mutations.remove.mutateAsync(asset.id);
                            void message.success('Media asset deleted.');
                          } catch (error) {
                            void message.error(
                              getUserErrorMessage(error, 'Media asset could not be deleted.'),
                            );
                            throw error;
                          }
                        },
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
