import mysql from 'mysql2/promise';
import { createDashboardIndexProbe } from './dashboardIndex.js';

export function createDatabase(env = process.env) {
  if (!Object.hasOwn(env, 'DB_PASSWORD')) throw new Error('Set DB_PASSWORD in app/server/.env (copy .env.example first).');
  const port = Number(env.DB_PORT || 3307);
  const queryTimeoutMs = Number(env.DB_QUERY_TIMEOUT_MS || 180_000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT must be a valid port.');
  if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 1000 || queryTimeoutMs > 210_000) throw new Error('DB_QUERY_TIMEOUT_MS must be between 1000 and 210000.');
  const options = {
    host: env.DB_HOST || '127.0.0.1', port,
    user: env.DB_USER || 'root', password: env.DB_PASSWORD,
    database: env.DB_NAME || 'nyc_yellow_taxi_2025',
    waitForConnections: true, queueLimit: 4, connectTimeout: 10_000,
    multipleStatements: false, enableKeepAlive: true,
  };
  const pool = mysql.createPool({ ...options, connectionLimit: 2 });
  const control = mysql.createPool({ ...options, connectionLimit: 1 });
  const dashboardIndexReady = createDashboardIndexProbe(async (sql, values) => {
    const [rows] = await pool.execute(sql, values);
    return rows;
  });
  return {
    queryTimeoutMs,
    dashboardIndexReady,
    async query(sql, values = [], signal) {
      signal?.throwIfAborted();
      const connection = await pool.getConnection();
      // Disconnect alone may leave a SELECT running on MySQL. Cancel only this
      // checked-out connection's query before discarding it; never kill others.
      const cancel = () => {
        const threadId = Number(connection.threadId);
        void control.query(`KILL QUERY ${threadId}`).catch(() => {}).finally(() => connection.destroy());
      };
      if (signal?.aborted) { connection.release(); signal.throwIfAborted(); }
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const [rows] = await connection.execute(sql, values);
        signal?.throwIfAborted();
        return rows;
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (!signal?.aborted) connection.release();
      }
    },
    close: () => Promise.all([pool.end(), control.end()]),
  };
}
