import { defineConfig } from 'vite';
import { apiProxy, sessionShell } from './astro.config.ts';

// Serve the same static session shell as the production Nginx configuration.
export default defineConfig({
  plugins: [sessionShell],
  preview: { proxy: apiProxy },
});
