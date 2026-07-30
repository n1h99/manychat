import { Card, Space, Tag, Typography } from 'antd';

interface PlaceholderPageProps {
  description: string;
  title: string;
}

export function PlaceholderPage({ description, title }: PlaceholderPageProps) {
  return (
    <Card>
      <Space orientation="vertical" size="middle">
        <Tag color="blue">Stage 0</Tag>
        <Typography.Title level={2}>{title}</Typography.Title>
        <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
      </Space>
    </Card>
  );
}
