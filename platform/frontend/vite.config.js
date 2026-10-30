import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The panel lives under /banana/; nespizdili.lol/ itself shows a stub page (platform/frontend/stub).
  base: '/banana/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/banana/api': { target: process.env.BACKEND_URL || 'http://127.0.0.1:4000', changeOrigin: true, rewrite: (p) => p.replace(/^\/banana/, '') },
      '/banana/uploads': { target: process.env.BACKEND_URL || 'http://127.0.0.1:4000', changeOrigin: true, rewrite: (p) => p.replace(/^\/banana/, '') },
      '/api': { target: process.env.BACKEND_URL || 'http://127.0.0.1:4000', changeOrigin: true },
      '/uploads': { target: process.env.BACKEND_URL || 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
});
