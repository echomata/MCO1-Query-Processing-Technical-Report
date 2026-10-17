import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('./server/.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

export default defineConfig({
  plugins: [svelte()],
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, timeout: 250_000, proxyTimeout: 250_000 } } },
  preview: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, timeout: 250_000, proxyTimeout: 250_000 } } },
});