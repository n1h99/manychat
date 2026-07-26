import { Navigate, Route, Routes } from 'react-router';

import { AppShell } from './app-shell';
import { ProtectedRoute } from './protected-route';
import { LoginPage } from './pages/login-page';
import { MembersPage } from './pages/members-page';
import { ProjectDetailPage } from './pages/project-detail-page';
import { ProjectsPage } from './pages/projects-page';
import { UsersPage } from './pages/users-page';
import { ContactsPage } from './pages/contacts-page';
import { ContactDetailPage } from './pages/contact-detail-page';
import { CustomFieldsPage } from './pages/custom-fields-page';
import { TagsPage } from './pages/tags-page';

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
          <Route element={<UsersPage />} path="/users" />
          <Route element={<Navigate replace to="/projects" />} path="*" />
        </Route>
      </Route>
    </Routes>
  );
}
