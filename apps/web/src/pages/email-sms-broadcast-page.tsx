import { MailOutlined } from '@ant-design/icons';
import { Card, Result, Typography } from 'antd';

export function EmailSmsBroadcastPage() {
  return (
    <section>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>Email &amp; SMS Broadcast</Typography.Title>
          <Typography.Text type="secondary">
            Create and manage direct email and SMS campaigns.
          </Typography.Text>
        </div>
      </div>

      <Card className="surface">
        <Result
          icon={<MailOutlined style={{ color: 'var(--primary)' }} />}
          subTitle="Email and SMS broadcasting tools are being prepared and will appear here soon."
          title="Under construction"
        />
      </Card>
    </section>
  );
}
