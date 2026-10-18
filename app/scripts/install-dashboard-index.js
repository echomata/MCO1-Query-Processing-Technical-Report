// Explicit, opt-in schema change. The API never creates an index on startup.
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { CREATE_DASHBOARD_INDEX_SQL, DASHBOARD_COVER_INDEX, isDashboardIndexReady } from '../server/dashboardIndex.js';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--status')) throw new Error('Usage: npm run db:index:dashboard -- [--status]');
process.loadEnvFile(fileURLToPath(new URL('../server/.env', import.meta.url)));
if (!Object.hasOwn(process.env, 'DB_PASSWORD')) throw new Error('Set DB_PASSWORD in server/.env first.');
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'nyc_yellow_taxi_2025', multipleStatements: false,
  connectTimeout: 10_000,
});
try {
  const [existing] = await connection.query('SHOW INDEX FROM fact_trip WHERE Key_name = ?', [DASHBOARD_COVER_INDEX]);
  if (args.includes('--status')) {
    console.log(JSON.stringify({ index: DASHBOARD_COVER_INDEX, ready: isDashboardIndexReady(existing), exists: existing.length > 0 }));
  } else if (existing.length) {
    if (!isDashboardIndexReady(existing)) throw new Error('The named index has a different definition or visibility. No changes made.');
    console.log('Dashboard covering index is already installed and invisible.');
  } else {
    // Fail instead of waiting indefinitely for another transaction's metadata lock.
    await connection.query('SET SESSION lock_wait_timeout = 10');
    console.log('Building the invisible dashboard index. Allow disk space and time for the entire fact table.');
    const started = performance.now();
    await connection.query(CREATE_DASHBOARD_INDEX_SQL);
    console.log(JSON.stringify({ index: DASHBOARD_COVER_INDEX, invisible: true, buildMs: Math.round(performance.now() - started) }));
  }
} catch (error) {
  console.error(error.code ? `Dashboard index operation failed: ${error.code}` : error.message);
  process.exitCode = 1;
} finally { await connection.end(); }
