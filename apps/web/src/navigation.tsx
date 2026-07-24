import {
  AppstoreOutlined,
  ContactsOutlined,
  DeploymentUnitOutlined,
  MessageOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface NavigationItem {
  icon: ReactNode;
  key: string;
  label: string;
  path: string;
}

export const navigationItems: readonly NavigationItem[] = [
  { icon: <AppstoreOutlined />, key: 'overview', label: 'Обзор', path: '/' },
  { icon: <ContactsOutlined />, key: 'contacts', label: 'Контакты', path: '/contacts' },
  {
    icon: <DeploymentUnitOutlined />,
    key: 'scenarios',
    label: 'Сценарии',
    path: '/scenarios',
  },
  { icon: <MessageOutlined />, key: 'channels', label: 'Каналы', path: '/channels' },
  { icon: <SettingOutlined />, key: 'settings', label: 'Настройки', path: '/settings' },
] as const;
