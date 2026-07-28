import { Spin } from 'antd';
import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { AppShell } from './app-shell';
import { ProtectedRoute } from './protected-route';
import { ProjectPermissionRoute } from './project-permission-route';

function lazyPage<TModule, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey,
) {
  return lazy(async () => ({
    default: (await loader())[exportName] as ComponentType,
  }));
}

const LoginPage = lazyPage(() => import('./pages/login-page'), 'LoginPage');
const MembersPage = lazyPage(() => import('./pages/members-page'), 'MembersPage');
const ProjectDetailPage = lazyPage(
  () => import('./pages/project-detail-page'),
  'ProjectDetailPage',
);
const ProjectsPage = lazyPage(() => import('./pages/projects-page'), 'ProjectsPage');
const UsersPage = lazyPage(() => import('./pages/users-page'), 'UsersPage');
const ContactsPage = lazyPage(() => import('./pages/contacts-page'), 'ContactsPage');
const ContactDetailPage = lazyPage(
  () => import('./pages/contact-detail-page'),
  'ContactDetailPage',
);
const CustomFieldsPage = lazyPage(() => import('./pages/custom-fields-page'), 'CustomFieldsPage');
const TagsPage = lazyPage(() => import('./pages/tags-page'), 'TagsPage');
const ChannelsPage = lazyPage(() => import('./pages/channels-page'), 'ChannelsPage');
const ChannelCreatePage = lazyPage(
  () => import('./pages/channel-create-page'),
  'ChannelCreatePage',
);
const ChannelDetailPage = lazyPage(
  () => import('./pages/channel-detail-page'),
  'ChannelDetailPage',
);
const ScenarioEditorPage = lazyPage(
  () => import('./pages/scenario-editor-page'),
  'ScenarioEditorPage',
);
const ScenariosPage = lazyPage(() => import('./pages/scenarios-page'), 'ScenariosPage');
const CrmConfigPage = lazyPage(() => import('./pages/crm-config-page'), 'CrmConfigPage');
const SegmentsPage = lazyPage(() => import('./pages/segments-page'), 'SegmentsPage');
const BroadcastsPage = lazyPage(() => import('./pages/broadcasts-page'), 'BroadcastsPage');
const BroadcastCreatePage = lazyPage(
  () => import('./pages/broadcast-create-page'),
  'BroadcastCreatePage',
);
const BroadcastDetailPage = lazyPage(
  () => import('./pages/broadcast-detail-page'),
  'BroadcastDetailPage',
);
const MediaAssetsPage = lazyPage(() => import('./pages/media-assets-page'), 'MediaAssetsPage');
const TemplatesPage = lazyPage(() => import('./pages/templates-page'), 'TemplatesPage');

export function App() {
  return (
    <Suspense
      fallback={
        <div
          aria-label="Загрузка страницы"
          role="status"
          style={{ display: 'grid', minHeight: '100vh', placeItems: 'center' }}
        >
          <Spin size="large" />
        </div>
      }
    >
      <Routes>
        <Route element={<LoginPage />} path="/login" />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route element={<Navigate replace to="/projects" />} path="/" />
            <Route element={<ProjectsPage />} path="/projects" />
            <Route element={<ProjectDetailPage />} path="/projects/:projectId" />
            <Route element={<MembersPage />} path="/projects/:projectId/members" />
            <Route element={<ContactsPage />} path="/projects/:projectId/contacts" />
            <Route
              element={<ContactDetailPage />}
              path="/projects/:projectId/contacts/:contactId"
            />
            <Route element={<TagsPage />} path="/projects/:projectId/tags" />
            <Route element={<CustomFieldsPage />} path="/projects/:projectId/custom-fields" />
            <Route element={<SegmentsPage />} path="/projects/:projectId/segments" />
            <Route element={<ProjectPermissionRoute permission="automation:read" />}>
              <Route element={<ScenariosPage />} path="/projects/:projectId/scenarios" />
              <Route element={<ProjectPermissionRoute permission="automation:manage" />}>
                <Route
                  element={<ScenarioEditorPage />}
                  path="/projects/:projectId/scenarios/:scenarioId"
                />
              </Route>
            </Route>
            <Route element={<ProjectPermissionRoute permission="integrations:manage" />}>
              <Route element={<CrmConfigPage />} path="/projects/:projectId/crm-config" />
            </Route>
            <Route element={<ProjectPermissionRoute permission="channels:read" />}>
              <Route element={<ChannelsPage />} path="/projects/:projectId/channels" />
              <Route
                element={<ChannelDetailPage />}
                path="/projects/:projectId/channels/:connectionId"
              />
              <Route element={<ProjectPermissionRoute permission="channels:manage" />}>
                <Route element={<ChannelCreatePage />} path="/projects/:projectId/channels/new" />
              </Route>
            </Route>
            <Route element={<ProjectPermissionRoute permission="broadcasts:read" />}>
              <Route element={<BroadcastsPage />} path="/projects/:projectId/broadcasts" />
              <Route
                element={<BroadcastDetailPage />}
                path="/projects/:projectId/broadcasts/:broadcastId"
              />
              <Route element={<ProjectPermissionRoute permission="broadcasts:create" />}>
                <Route
                  element={<BroadcastCreatePage />}
                  path="/projects/:projectId/broadcasts/new"
                />
              </Route>
            </Route>
            <Route element={<ProjectPermissionRoute permission="templates:read" />}>
              <Route element={<TemplatesPage />} path="/projects/:projectId/templates" />
            </Route>
            <Route element={<ProjectPermissionRoute permission="media:read" />}>
              <Route element={<MediaAssetsPage />} path="/projects/:projectId/media-assets" />
            </Route>
            <Route element={<UsersPage />} path="/users" />
            <Route element={<Navigate replace to="/projects" />} path="*" />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
