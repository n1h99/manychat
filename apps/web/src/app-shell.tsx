import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { useAuth } from './auth';
import { navigationItems } from './navigation';
import { shellActions, type AppDispatch, type RootState } from './store';

const { Content, Header, Sider } = Layout;

export function AppShell() {
  const collapsed = useSelector((state: RootState) => state.shell.sidebarCollapsed);
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();
  const navigate = useNavigate();
  const { identity, logout } = useAuth();
  const selectedKey = useMemo(
    () =>
      navigationItems.find((item) => location.pathname.startsWith(item.path))?.key ?? 'projects',
    [location.pathname],
  );
  return (
    <Layout className="app-shell">
      <Sider collapsed={collapsed} collapsible trigger={null} theme="light">
        <div className="brand">OM</div>
        <Menu
          items={navigationItems.map(({ icon, key, label }) => ({ icon, key, label }))}
          mode="inline"
          onClick={({ key }) => {
            const item = navigationItems.find((candidate) => candidate.key === key);
            if (item) void navigate(item.path);
          }}
          selectedKeys={[selectedKey]}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space>
            <Button
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => dispatch(shellActions.toggleSidebar())}
              type="text"
            />
            <Typography.Text strong>Omnicus</Typography.Text>
            <Typography.Text type="secondary">{identity?.email}</Typography.Text>
            <Button onClick={() => void logout()} type="link">
              Sign out
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
