import { Spin } from 'antd';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth';

export function ProtectedRoute() {
  const { identity, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <Spin className="route-loading" size="large" />;
  }
  return identity ? (
    <Outlet />
  ) : (
    <Navigate replace state={{ from: location.pathname }} to="/login" />
  );
}
