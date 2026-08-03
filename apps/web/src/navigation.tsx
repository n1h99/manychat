import {
  AppstoreOutlined,
  DashboardOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface NavigationItem {
  icon: ReactNode;
  key: string;
  label: string;
  path: string;
  permission?: string;
}

export const navigationItems: readonly NavigationItem[] = [
  { icon: <AppstoreOutlined />, key: 'projects', label: 'Projects', path: '/projects' },
  {
    icon: <ThunderboltOutlined />,
    key: 'automation-activity',
    label: 'Automation activity',
    path: '/automation-activity',
  },
  {
    icon: <TeamOutlined />,
    key: 'users',
    label: 'Users',
    path: '/users',
    permission: 'users:read',
  },
  {
    icon: <SafetyCertificateOutlined />,
    key: 'roles',
    label: 'System roles',
    path: '/roles',
    permission: 'roles:manage',
  },
  {
    icon: <DashboardOutlined />,
    key: 'system-health',
    label: 'System health',
    path: '/system-health',
    permission: 'roles:manage',
  },
] as const;
