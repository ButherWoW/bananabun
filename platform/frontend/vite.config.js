import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import JavaScriptObfuscator from 'javascript-obfuscator';
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

// Production builds only: every JS chunk is obfuscated (renamed identifiers, strings hidden in an encoded array),
// and no source maps are written, so the code in the browser does not show how the panel is built. No eval or
// self-defending code: the same chunks keep working under a strict CSP. BUILD_OBFUSCATE=0 skips it (faster local builds).
const OBFUSCATOR = {
  target: 'browser',
  compact: true,
  identifierNamesGenerator: 'mangled-shuffled',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'function',
  splitStrings: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  numbersToExpressions: false,
  unicodeEscapeSequence: false,
  sourceMap: false,
};
function obfuscate() {
  return {
    name: 'bananabun-obfuscate',
    apply: 'build',
    // After the bundle is final: file names inside the code (dynamic imports) are already filled in by then.
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        if (process.env.BUILD_OBFUSCATE === '0') return;
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          chunk.code = JavaScriptObfuscator.obfuscate(chunk.code, OBFUSCATOR).getObfuscatedCode();
          chunk.map = null;
        }
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    // The panel lives under /banana/; nespizdili.lol/ itself shows a stub page (platform/frontend/stub).
    base: demo ? '/banana/demo/' : '/banana/',
    plugins: [react(), ...(demo ? [demoBuild()] : []), obfuscate()],
    build: { sourcemap: false, ...(demo ? { outDir: 'dist-demo' } : {}) },
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
