import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Breadcrumb, Button, Drawer, Grid, Layout, Menu, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { useAuth } from './auth';
import { apiRequest } from './api';
import { breadcrumbsFor } from './breadcrumbs';
import { navigationItems, type NavigationItem } from './navigation';
import { ProfileSettingsModal } from './profile-settings-modal';
import { hasProjectPermission, useProjectAccess } from './project-access';
import { shellActions, type AppDispatch, type RootState } from './store';

const { Content, Header, Sider } = Layout;
const { useBreakpoint } = Grid;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'brand brand--compact' : 'brand'}>
      <span className="brand-mark" aria-hidden="true">
        OM
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>Omnicus</strong>
          <small>Customer platform</small>
        </span>
      )}
    </div>
  );
}

export function AppShell() {
  const collapsed = useSelector((state: RootState) => state.shell.sidebarCollapsed);
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();
  const navigate = useNavigate();
  const { accessToken, identity, logout } = useAuth();
  const screens = useBreakpoint();
  const isMobile = screens.lg === false;
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const projectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const projectAccess = useProjectAccess(projectId);
  const availableNavigation = useMemo(() => {
    const contextual: NavigationItem[] =
      projectId && hasProjectPermission(projectAccess.data, 'automation:read')
        ? [
            {
              icon: <ThunderboltOutlined />,
              key: 'automation-activity',
              label: 'Automation activity',
              path: `/projects/${projectId}/automation-activity`,
            },
          ]
        : [];
    return [...contextual, ...navigationItems].filter(
      (item) =>
        !item.permission ||
        identity?.globalRoleNames.includes('super-admin') ||
        identity?.globalPermissions.includes(item.permission),
    );
  }, [identity, projectAccess.data, projectId]);
  const selectedKey = useMemo(
    () =>
      availableNavigation.find((item) => location.pathname.startsWith(item.path))?.key ??
      'projects',
    [availableNavigation, location.pathname],
  );
  const selectedItem = availableNavigation.find((item) => item.key === selectedKey);
  const accountName =
    [identity?.firstName, identity?.lastName].filter(Boolean).join(' ') || 'Account';
  const accountRole = identity?.globalRoleNames[0]
    ?.split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
  const menuItems = availableNavigation.map(({ icon, key, label }) => ({ icon, key, label }));
  const project = useQuery({
    enabled: Boolean(projectId),
    queryFn: () => apiRequest<{ name: string }>(`/api/v1/projects/${projectId}`, {}, accessToken),
    queryKey: ['project', projectId, accessToken],
  });
  const breadcrumbs = breadcrumbsFor(location.pathname, project.data?.name);

  const navigation = (
    <>
      <Brand compact={!isMobile && collapsed} />
      <Menu
        className="app-navigation"
        items={menuItems}
        mode="inline"
        onClick={({ key }) => {
          const item = availableNavigation.find((candidate) => candidate.key === key);
          if (item) {
            void navigate(item.path);
            setMobileNavigationOpen(false);
          }
        }}
        selectedKeys={[selectedKey]}
      />
      <div className="sidebar-footer">
        {!collapsed || isMobile ? (
          <>
            <span className="sidebar-footer-dot" />
            <span>System online</span>
          </>
        ) : (
          <span className="sidebar-footer-dot" aria-label="System online" />
        )}
      </div>
    </>
  );

  return (
    <Layout className="app-shell">
      {!isMobile && (
        <Sider
          className="app-sidebar"
          collapsed={collapsed}
          collapsedWidth={84}
          collapsible
          trigger={null}
          theme="light"
          width={248}
        >
          {navigation}
        </Sider>
      )}
      <Drawer
        className="mobile-navigation"
        closable={false}
        onClose={() => setMobileNavigationOpen(false)}
        open={isMobile && mobileNavigationOpen}
        placement="left"
        width={280}
      >
        {navigation}
      </Drawer>
      <Layout className="app-main">
        <Header className="app-header">
          <div className="app-header-context">
            <Button
              aria-label={
                isMobile
                  ? 'Open navigation'
                  : collapsed
                    ? 'Expand navigation'
                    : 'Collapse navigation'
              }
              className="navigation-toggle"
              icon={
                isMobile ? (
                  <MenuOutlined />
                ) : collapsed ? (
                  <MenuUnfoldOutlined />
                ) : (
                  <MenuFoldOutlined />
                )
              }
              onClick={() =>
                isMobile ? setMobileNavigationOpen(true) : dispatch(shellActions.toggleSidebar())
              }
              type="text"
            />
            <div>
              <Typography.Text className="header-title">
                {selectedItem?.label ?? 'Omnicus'}
              </Typography.Text>
            </div>
          </div>
          <div className="account-toolbar">
            <div className="account-identity-chip">
              <strong>{accountName}</strong>
              {accountRole ? <Tag>{accountRole}</Tag> : null}
            </div>
            <Button icon={<SettingOutlined />} onClick={() => setProfileOpen(true)}>
              Profile
            </Button>
            <Button
              className="sign-out-button"
              icon={<LogoutOutlined />}
              onClick={() => void logout()}
            >
              Sign out
            </Button>
          </div>
        </Header>
        <Content className="app-content">
          <div className="page-frame">
            {breadcrumbs.length > 1 ? (
              <nav aria-label="Breadcrumb" className="app-breadcrumbs">
                <Breadcrumb
                  items={breadcrumbs.map((breadcrumb) => ({
                    title: breadcrumb.path ? (
                      <Link to={breadcrumb.path}>{breadcrumb.label}</Link>
                    ) : (
                      breadcrumb.label
                    ),
                  }))}
                  separator={<RightOutlined />}
                />
              </nav>
            ) : null}
            <Outlet />
          </div>
        </Content>
        <ProfileSettingsModal onClose={() => setProfileOpen(false)} open={profileOpen} />
      </Layout>
    </Layout>
  );
}
