import { Button, Modal, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { useState } from 'react';
import { useParams } from 'react-router';

import { type MediaAsset, useMediaAssets, useMediaMutations } from '../media-api';
import { hasProjectPermission, useProjectAccess } from '../project-access';

export function MediaAssetsPage() {
  const { projectId } = useParams();
  const assets = useMediaAssets(projectId);
  const mutations = useMediaMutations(projectId);
  const access = useProjectAccess(projectId);
  const canManage = hasProjectPermission(access.data, 'media:manage');
  const [file, setFile] = useState<File>();
  const [kind, setKind] = useState<'DOCUMENT' | 'PHOTO'>('PHOTO');
  const upload = async () => {
    if (!file) return;
    try {
      await mutations.upload.mutateAsync({ file, kind });
      setFile(undefined);
      void message.success('Media asset uploaded.');
    } catch {
      void message.error(
        'Upload failed. Photos must be JPEG, PNG or WebP, at most 10 MB, with an aspect ratio no greater than 20:1.',
      );
    }
  };
  return (
    <section>
      <Typography.Title level={2}>Media assets</Typography.Title>
      <Typography.Paragraph type="secondary">
        Private assets are validated before storage. Signed download links are created only on
        demand and are never persisted. Telegram photos must be at most 10 MB, have a width plus
        height no greater than 10,000, and an aspect ratio no greater than 20:1.
      </Typography.Paragraph>
      {canManage ? (
        <Space className="section-actions" wrap>
          <Select
            onChange={setKind}
            options={[
              { label: 'Photo (JPEG/PNG/WebP)', value: 'PHOTO' },
              { label: 'Document (PDF/ZIP)', value: 'DOCUMENT' },
            ]}
            value={kind}
          />
          <Upload
            accept={kind === 'PHOTO' ? '.jpg,.jpeg,.png,.webp' : '.pdf,.zip'}
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
