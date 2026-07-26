import { Input, Select, Space, Table, Tag, Typography } from 'antd';
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
  status: 'ACTIVE' | 'ARCHIVED';
  tags: { tag: { id: string; name: string; color: string | null } }[];
  channelIdentities: { channel: string }[];
}

interface ContactPage {
  items: ContactRow[];
  page: number;
  pageSize: number;
  total: number;
}

export function ContactsPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>();
  const queryString = useMemo(
    () =>
      new URLSearchParams({
        page: String(page),
        pageSize: '25',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
      }).toString(),
    [page, search, status],
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
  return (
    <section>
      <Space className="page-heading" direction="vertical" size={0}>
        <Typography.Title level={2}>Contacts</Typography.Title>
        <Typography.Text type="secondary">Project contact directory.</Typography.Text>
      </Space>
      <Space className="section-actions" wrap>
        <Input
          allowClear
          aria-label="Search contacts"
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          placeholder="Name, username, phone or email"
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
            { label: 'Archived', value: 'ARCHIVED' },
          ]}
          placeholder="Status"
          value={status}
        />
      </Space>
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
