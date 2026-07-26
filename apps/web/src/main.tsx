import 'antd/dist/reset.css';
import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router';

import { App } from './app';
import { AuthProvider } from './auth';
import { ErrorBoundary } from './error-boundary';
import { readWebEnvironment } from './env';
import { store } from './store';

const queryClient = new QueryClient();
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element is missing');
}

const root = createRoot(rootElement);

try {
  const webEnvironment = readWebEnvironment();
  document.documentElement.dataset.apiUrl = webEnvironment.VITE_API_URL;

  root.render(
    <StrictMode>
      <ErrorBoundary>
        <ConfigProvider
          theme={{
            token: {
              borderRadius: 8,
              colorPrimary: '#3659e3',
            },
          }}
        >
          <Provider store={store}>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
              </AuthProvider>
            </QueryClientProvider>
          </Provider>
        </ConfigProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
} catch {
  root.render(
    <main className="bootstrap-error" role="alert">
      <h1>Конфигурация интерфейса недоступна</h1>
      <p>Сборка не содержит обязательный адрес API.</p>
    </main>,
  );
}
