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
            components: {
              Button: {
                dangerShadow: 'none',
                defaultShadow: 'none',
                primaryShadow: 'none',
              },
              Input: {
                activeShadow: 'none',
              },
              Select: {
                activeBorderColor: '#94a3b8',
                activeOutlineColor: 'transparent',
                hoverBorderColor: '#94a3b8',
                optionSelectedBg: '#eef3f8',
                optionSelectedColor: '#0f172a',
              },
            },
            token: {
              borderRadius: 12,
              borderRadiusLG: 20,
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
              boxShadowSecondary: '0 18px 40px rgba(15, 23, 42, 0.08)',
              colorBgContainer: '#ffffff',
              colorBgLayout: '#f4f7fb',
              colorBorder: '#e2e8f0',
              colorError: '#dc2626',
              colorInfo: '#0ea5e9',
              colorLink: '#1677ff',
              colorPrimary: '#0f766e',
              colorSuccess: '#15803d',
              colorText: '#0f172a',
              colorTextSecondary: '#64748b',
              colorWarning: '#d97706',
              controlHeight: 42,
              controlHeightLG: 46,
              fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontSize: 14,
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
      <h1>Interface configuration is unavailable</h1>
      <p>The build does not contain the required API address.</p>
    </main>,
  );
}
