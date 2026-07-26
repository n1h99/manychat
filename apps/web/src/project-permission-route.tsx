import { Result, Spin } from 'antd';
import { Link, Outlet, useParams } from 'react-router';

import { hasProjectPermission, useProjectAccess } from './project-access';

interface ProjectPermissionRouteProperties {
  permission: string;
}

export function ProjectPermissionRoute({ permission }: ProjectPermissionRouteProperties) {
  const { projectId } = useParams();
  const access = useProjectAccess(projectId);

  if (access.isLoading) {
    return <Spin className="route-loading" size="large" />;
  }

  if (access.isError || !hasProjectPermission(access.data, permission)) {
    return (
      <Result
        extra={<Link to={projectId ? `/projects/${projectId}` : '/projects'}>Back to project</Link>}
        status="403"
        subTitle="Your account does not have access to this project feature."
        title="Access denied"
      />
    );
  }

  return <Outlet />;
}
