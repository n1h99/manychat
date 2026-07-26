import { Spin } from 'antd';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth';

export function unauthenticatedRedirect(
  _pathname: string,
  authenticated: boolean,
): string | undefined {
  return authenticated ? undefined : '/login';
}

export function ProtectedRoute() {
  const { identity, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <Spin className="route-loading" size="large" />;
  }
  const redirect = unauthenticatedRedirect(location.pathname, Boolean(identity));
  return redirect ? (
    <Navigate replace state={{ from: location.pathname }} to={redirect} />
  ) : (
    <Outlet />
  );
}
