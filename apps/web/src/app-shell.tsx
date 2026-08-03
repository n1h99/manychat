import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  Breadcrumb,
  Button,
  Drawer,
  Empty,
  Grid,
  Layout,
  Menu,
  Modal,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { useAuth } from './auth';
import { ApiError, apiRequest } from './api';
import { breadcrumbsFor } from './breadcrumbs';
import { navigationItems } from './navigation';
import { ProfileSettingsModal } from './profile-settings-modal';
import { hasProjectPermission, type ProjectAccess, useProjectAccess } from './project-access';
import { shellActions, type AppDispatch, type RootState } from './store';

const { Content, Header, Sider } = Layout;
const { useBreakpoint } = Grid;

interface NavigationProject {
  id: string;
  name: string;
}

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
  const [activityProjectPickerOpen, setActivityProjectPickerOpen] = useState(false);
  const projectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const projectAccess = useProjectAccess(projectId);
  const availableNavigation = useMemo(() => {
    return navigationItems.filter(
      (item) =>
        !item.permission ||
        identity?.globalRoleNames.includes('super-admin') ||
        identity?.globalPermissions.includes(item.permission),
    );
  }, [identity]);
  const selectedKey = useMemo(() => {
    if (location.pathname.includes('/automation-activity')) return 'automation-activity';
    return (
      [...availableNavigation]
        .sort((left, right) => right.path.length - left.path.length)
        .find((item) => location.pathname.startsWith(item.path))?.key ?? 'projects'
    );
  }, [availableNavigation, location.pathname]);
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
  const activityProjects = useQuery({
    enabled: false,
    queryFn: async () => {
      const projects = await apiRequest<NavigationProject[]>('/api/v1/projects', {}, accessToken);
      const availableProjects = await Promise.all(
        projects.map(async (candidate) => {
          try {
            const access = await apiRequest<ProjectAccess>(
              `/api/v1/projects/${candidate.id}/access`,
              {},
              accessToken,
            );
            return hasProjectPermission(access, 'automation:read') ? candidate : undefined;
          } catch (error) {
            if (error instanceof ApiError && [403, 404].includes(error.status)) return undefined;
            throw error;
          }
        }),
      );
      return availableProjects.filter(
        (candidate): candidate is NavigationProject => candidate !== undefined,
      );
    },
    queryKey: ['automation-activity-projects', identity?.userId, accessToken],
  });
  const breadcrumbs = breadcrumbsFor(location.pathname, project.data?.name);

  const goToAutomationActivity = (targetProjectId: string) => {
    setActivityProjectPickerOpen(false);
    setMobileNavigationOpen(false);
    void navigate(`/projects/${targetProjectId}/automation-activity`);
  };

  const openAutomationActivity = async () => {
    if (projectId && hasProjectPermission(projectAccess.data, 'automation:read')) {
      goToAutomationActivity(projectId);
      return;
    }
    const result = await activityProjects.refetch();
    if (result.isError) {
      void message.error('Automation activity could not be opened. Please try again.');
      return;
    }
    const projects = result.data ?? [];
    if (projects.length === 0) {
      void message.info('You do not have access to automation activity in any project.');
      return;
    }
    if (projects.length === 1) {
      const onlyProject = projects[0];
      if (onlyProject) goToAutomationActivity(onlyProject.id);
      return;
    }
    setMobileNavigationOpen(false);
    setActivityProjectPickerOpen(true);
  };

  const navigation = (
    <>
      <Brand compact={!isMobile && collapsed} />
      <Menu
        className="app-navigation"
        items={menuItems}
        mode="inline"
        onClick={({ key }) => {
          if (key === 'automation-activity') {
            void openAutomationActivity();
            return;
          }
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
        <Modal
          className="activity-project-picker-modal"
          footer={null}
          onCancel={() => setActivityProjectPickerOpen(false)}
          open={activityProjectPickerOpen}
          title="Choose a project"
        >
          <Typography.Paragraph type="secondary">
            Select the workspace whose automation journeys you want to review.
          </Typography.Paragraph>
          <div className="activity-project-picker">
            {activityProjects.data?.length ? (
              activityProjects.data.map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => goToAutomationActivity(candidate.id)}
                  type="button"
                >
                  <span>{candidate.name}</span>
                  <RightOutlined />
                </button>
              ))
            ) : (
              <Empty description="No projects with automation access" />
            )}
          </div>
        </Modal>
      </Layout>
    </Layout>
  );
}
