import { Result, Spin } from 'antd';
import { Link, Outlet } from 'react-router';

import { useAuth } from './auth';

export function GlobalPermissionRoute({ permission }: { permission: string }) {
  const { identity, loading } = useAuth();
  if (loading) return <Spin className="route-loading" size="large" />;
  const allowed =
    identity?.globalRoleNames.includes('super-admin') ||
    identity?.globalPermissions.includes(permission);
  if (!allowed)
    return (
      <Result
        extra={<Link to="/projects">Back to projects</Link>}
        status="403"
        subTitle="Your account does not have access to this system feature."
        title="Access denied"
      />
    );
  return <Outlet />;
}
