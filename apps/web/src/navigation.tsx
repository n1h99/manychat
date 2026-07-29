import { AppstoreOutlined, TeamOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface NavigationItem {
  icon: ReactNode;
  key: string;
  label: string;
  path: string;
}

export const navigationItems: readonly NavigationItem[] = [
  { icon: <AppstoreOutlined />, key: 'projects', label: 'Projects', path: '/projects' },
  { icon: <TeamOutlined />, key: 'users', label: 'Users', path: '/users' },
] as const;
