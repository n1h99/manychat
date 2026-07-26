import { Navigate, Route, Routes } from 'react-router';

import { AppShell } from './app-shell';
import { ProtectedRoute } from './protected-route';
import { ProjectPermissionRoute } from './project-permission-route';
import { LoginPage } from './pages/login-page';
import { MembersPage } from './pages/members-page';
import { ProjectDetailPage } from './pages/project-detail-page';
import { ProjectsPage } from './pages/projects-page';
import { UsersPage } from './pages/users-page';
import { ContactsPage } from './pages/contacts-page';
import { ContactDetailPage } from './pages/contact-detail-page';
import { CustomFieldsPage } from './pages/custom-fields-page';
import { TagsPage } from './pages/tags-page';
import { ChannelsPage } from './pages/channels-page';
import { ChannelCreatePage } from './pages/channel-create-page';
import { ChannelDetailPage } from './pages/channel-detail-page';
import { ScenarioEditorPage } from './pages/scenario-editor-page';
import { ScenariosPage } from './pages/scenarios-page';
import { CrmConfigPage } from './pages/crm-config-page';

export function App() {
  return (
    <Routes>
      <Route element={<LoginPage />} path="/login" />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route element={<Navigate replace to="/projects" />} path="/" />
          <Route element={<ProjectsPage />} path="/projects" />
          <Route element={<ProjectDetailPage />} path="/projects/:projectId" />
          <Route element={<MembersPage />} path="/projects/:projectId/members" />
          <Route element={<ContactsPage />} path="/projects/:projectId/contacts" />
          <Route element={<ContactDetailPage />} path="/projects/:projectId/contacts/:contactId" />
          <Route element={<TagsPage />} path="/projects/:projectId/tags" />
          <Route element={<CustomFieldsPage />} path="/projects/:projectId/custom-fields" />
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
          <Route element={<UsersPage />} path="/users" />
          <Route element={<Navigate replace to="/projects" />} path="*" />
        </Route>
      </Route>
    </Routes>
  );
}
