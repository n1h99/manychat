import {
  DownOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Space,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { useAuth } from './auth';
import { breadcrumbsFor } from './breadcrumbs';
import { navigationItems } from './navigation';
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
  const { identity, logout } = useAuth();
  const screens = useBreakpoint();
  const isMobile = screens.lg === false;
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const selectedKey = useMemo(
    () =>
      navigationItems.find((item) => location.pathname.startsWith(item.path))?.key ?? 'projects',
    [location.pathname],
  );
  const selectedItem = navigationItems.find((item) => item.key === selectedKey);
  const avatarLabel = identity?.email?.slice(0, 1).toUpperCase() ?? 'O';
  const menuItems = navigationItems.map(({ icon, key, label }) => ({ icon, key, label }));
  const breadcrumbs = breadcrumbsFor(location.pathname);

  const navigation = (
    <>
      <Brand compact={!isMobile && collapsed} />
      <Menu
        className="app-navigation"
        items={menuItems}
        mode="inline"
        onClick={({ key }) => {
          const item = navigationItems.find((candidate) => candidate.key === key);
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
              <Typography.Text className="header-kicker">Workspace</Typography.Text>
              <Typography.Text className="header-title">
                {selectedItem?.label ?? 'Omnicus'}
              </Typography.Text>
            </div>
          </div>
          <Dropdown
            menu={{
              items: [
                {
                  danger: true,
                  icon: <LogoutOutlined />,
                  key: 'logout',
                  label: 'Sign out',
                },
              ],
              onClick: ({ key }) => {
                if (key === 'logout') void logout();
              },
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Button className="account-menu" type="text">
              <Space size={10}>
                <Avatar size={34}>{avatarLabel}</Avatar>
                <span className="account-copy">
                  <strong>{identity?.email ?? 'Account'}</strong>
                  <small>Manage session</small>
                </span>
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
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
                />
              </nav>
            ) : null}
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
