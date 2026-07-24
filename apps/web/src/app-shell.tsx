import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';

import { navigationItems } from './navigation';
import { shellActions, type AppDispatch, type RootState } from './store';

const { Content, Header, Sider } = Layout;

export function AppShell() {
  const collapsed = useSelector((state: RootState) => state.shell.sidebarCollapsed);
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();
  const navigate = useNavigate();

  const selectedKey = useMemo(
    () =>
      navigationItems.find((item) =>
        item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path),
      )?.key ?? 'overview',
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
            if (item) {
              void navigate(item.path);
            }
          }}
          selectedKeys={[selectedKey]}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space>
            <Button
              aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => dispatch(shellActions.toggleSidebar())}
              type="text"
            />
            <Typography.Text strong>Omnicus</Typography.Text>
            <Typography.Text type="secondary">Infrastructure scaffold</Typography.Text>
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
