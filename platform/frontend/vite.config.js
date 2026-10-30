import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { demoImageFiles } from './src/api/demo-images.js';

// `vite build --mode demo`: the public demo under /banana/demo/. Its API is answered in the browser
// (src/api/demo.js); the page itself may not open any connection, so even a missed call cannot reach the backend.
function demoBuild() {
  return {
    name: 'bananabun-demo',
    transformIndexHtml(html, ctx) {
      // The dev server (vite --mode demo) needs its HMR websocket, so the connection ban is for the build only.
      const csp = ctx.server ? '' : `\n    <meta http-equiv="Content-Security-Policy" content="connect-src 'none'" />`;
      return html
        .replace(/(<meta charset[^>]*>)/, `$1${csp}\n    <meta name="robots" content="noindex, nofollow" />`)
        .replace(/<title>([^<]*)<\/title>/, '<title>$1 · демо</title>');
    },
    configureServer(server) {
      const files = demoImageFiles();
      server.middlewares.use((req, res, next) => {
        const file = files[String(req.url || '').split('?')[0].replace(/^\/banana\/demo\//, '')];
        if (!file) return next();
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(file);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(demoImageFiles())) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    // The panel lives under /banana/; nespizdili.lol/ itself shows a stub page (platform/frontend/stub).
    base: demo ? '/banana/demo/' : '/banana/',
    plugins: [react(), ...(demo ? [demoBuild()] : [])],
    build: demo ? { outDir: 'dist-demo' } : {},
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
  };
});
