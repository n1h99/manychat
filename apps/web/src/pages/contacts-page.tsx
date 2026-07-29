import { SearchOutlined } from '@ant-design/icons';
import { Alert, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { apiRequest } from '../api';
import { useAuth } from '../auth';

interface ContactRow {
  id: string;
  displayName: string;
  email: string | null;
  lastInteractionAt: string | null;
  status: 'ACTIVE' | 'BLOCKED' | 'UNSUBSCRIBED' | 'ARCHIVED' | 'MERGED';
  tags: { tag: { id: string; name: string; color: string | null } }[];
  channelIdentities: { channel: string }[];
}

interface ContactPage {
  items: ContactRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface SegmentItem {
  id: string;
  name: string;
}

export function ContactsPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>();
  const [segmentId, setSegmentId] = useState<string>();
  const queryString = useMemo(
    () =>
      new URLSearchParams({
        page: String(page),
        pageSize: '25',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(segmentId ? { segmentId } : {}),
      }).toString(),
    [page, search, segmentId, status],
  );
  const contacts = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<ContactPage>(
        `/api/v1/projects/${projectId}/contacts?${queryString}`,
        {},
        accessToken,
      ),
    queryKey: ['contacts', projectId, accessToken, queryString],
  });
  const segments = useQuery({
    enabled: Boolean(projectId),
    queryFn: () =>
      apiRequest<SegmentItem[]>(`/api/v1/projects/${projectId}/segments`, {}, accessToken),
    queryKey: ['segments', projectId],
  });

  return (
    <section>
      <div className="page-heading">
        <div>
          <Typography.Text className="header-kicker">Audience</Typography.Text>
          <Typography.Title level={2}>Contacts</Typography.Title>
          <Typography.Text type="secondary">
            Search, filter and manage the people connected to this project.
          </Typography.Text>
        </div>
      </div>
      <div className="filter-panel surface">
        <Space wrap>
          <Input
            allowClear
            aria-label="Search contacts"
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Name, username, phone or email"
            prefix={<SearchOutlined />}
            style={{ width: 320 }}
            value={search}
          />
          <Select
            allowClear
            aria-label="Contact status"
            onChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
            options={[
              { label: 'Active', value: 'ACTIVE' },
              { label: 'Blocked', value: 'BLOCKED' },
              { label: 'Unsubscribed', value: 'UNSUBSCRIBED' },
              { label: 'Archived', value: 'ARCHIVED' },
              { label: 'Merged', value: 'MERGED' },
            ]}
            placeholder="Status"
            style={{ width: 180 }}
            value={status}
          />
          <Select
            allowClear
            aria-label="Contact segment"
            onChange={(value) => {
              setPage(1);
              setSegmentId(value);
            }}
            options={(segments.data ?? []).map((segment) => ({
              label: segment.name,
              value: segment.id,
            }))}
            placeholder="Segment"
            style={{ width: 220 }}
            value={segmentId}
          />
        </Space>
      </div>
      {contacts.isError ? (
        <Alert
          className="form-alert"
          message="Contacts could not be loaded. Refresh the page or try again."
          showIcon
          type="error"
        />
      ) : null}
      <Table<ContactRow>
        columns={[
          {
            dataIndex: 'displayName',
            render: (name, row) => (
              <Link to={`/projects/${projectId}/contacts/${row.id}`}>{name}</Link>
            ),
            title: 'Name',
          },
          { dataIndex: 'email', title: 'Email' },
          {
            dataIndex: 'channelIdentities',
            render: (items) =>
              items.map((item: { channel: string }) => (
                <Tag key={item.channel}>{item.channel}</Tag>
              )),
            title: 'Channels',
          },
          {
            dataIndex: 'tags',
            render: (items) =>
              items.map((item: ContactRow['tags'][number]) => (
                <Tag {...(item.tag.color ? { color: item.tag.color } : {})} key={item.tag.id}>
                  {item.tag.name}
                </Tag>
              )),
            title: 'Tags',
          },
          {
            dataIndex: 'status',
            render: (value) => <Tag color={value === 'ACTIVE' ? 'green' : 'orange'}>{value}</Tag>,
            title: 'Status',
          },
          {
            dataIndex: 'lastInteractionAt',
            render: (value: string | null) => (value ? new Date(value).toLocaleString() : '—'),
            title: 'Last interaction',
          },
        ]}
        dataSource={contacts.data?.items ?? []}
        loading={contacts.isLoading}
        locale={{
          emptyText: (
            <Empty
              description="No contacts match the selected filters"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
        pagination={{
          current: page,
          onChange: setPage,
          pageSize: 25,
          total: contacts.data?.total ?? 0,
        }}
        rowKey="id"
      />
    </section>
  );
}
