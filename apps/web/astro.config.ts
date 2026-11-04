import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import type { Connect, PreviewServer, ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const env = loadEnv(
  process.env.NODE_ENV ?? 'development',
  workspaceRoot,
  'DOMAIN',
);

// Session IDs are resolved by the client island in the static session shell.
const sessionRoute: Connect.NextHandleFunction = (req, _res, next) => {
  if (/^\/session\/[^/?]+\/?(?:\?.*)?$/.test(req.url ?? '')) {
    req.url = '/session/';
  }
  next();
};

export const sessionShell = {
  name: 'session-shell',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(sessionRoute);
  },
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use(sessionRoute);
  },
};

export const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3000',
    headers: { Host: env.DOMAIN || 'localhost' },
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss(), sessionShell],
    server: { proxy: apiProxy },
  },
});
