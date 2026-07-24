import { Navigate, Route, Routes } from 'react-router';

import { AppShell } from './app-shell';
import { PlaceholderPage } from './pages/placeholder-page';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          element={
            <PlaceholderPage
              description="Базовый интерфейс готов. Бизнес-виджеты появятся на следующих этапах."
              title="Обзор"
            />
          }
          index
        />
        <Route
          element={
            <PlaceholderPage
              description="Модель и интерфейс контактов не входят в Этап 0."
              title="Контакты"
            />
          }
          path="contacts"
        />
        <Route
          element={
            <PlaceholderPage
              description="Automation runtime и редактор сценариев будут реализованы позже."
              title="Сценарии"
            />
          }
          path="scenarios"
        />
        <Route
          element={
            <PlaceholderPage
              description="Channel adapters, включая Telegram, не входят в текущий этап."
              title="Каналы"
            />
          }
          path="channels"
        />
        <Route
          element={
            <PlaceholderPage
              description="Настройки проекта и пользователей появятся после инфраструктурного этапа."
              title="Настройки"
            />
          }
          path="settings"
        />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Route>
    </Routes>
  );
}
