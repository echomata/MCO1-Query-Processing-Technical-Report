import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';
import { createApp } from './app.js';

const envPath = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

try {
  const port = Number(process.env.API_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port.');
  const database = createDatabase();
  const app = createApp({ database, distPath: fileURLToPath(new URL('../dist', import.meta.url)) });
  const server = app.listen(port, '127.0.0.1', () => console.log(`Meter API: http://127.0.0.1:${port} (MySQL ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3307})`));
  server.on('error', (error) => { console.error(`API could not start: ${error.message}`); process.exit(1); });
  const shutdown = () => { server.close(); database.close().finally(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}