import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  build: {
    sourcemap: true,
  },
  envDir: '../..',
  plugins: [react()],
  resolve: {
    alias: {
      '@omnicus/config': fileURLToPath(
        new URL('../../packages/config/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '0.0.0.0',
  },
});
