import 'antd/dist/reset.css';
import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';

import { App } from './app';
import { webEnvironment } from './env';
import { store } from './store';

const queryClient = new QueryClient();
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element is missing');
}

document.documentElement.dataset.apiUrl = webEnvironment.VITE_API_URL;

createRoot(rootElement).render(
  <StrictMode>
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
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </Provider>
    </ConfigProvider>
  </StrictMode>,
);
