import express from 'express';
import { existsSync } from 'node:fs';
import { parseFilters } from '../src/lib/reportFilters.js';
import { buildReportQuery, formatReport, LIVE_REPORTS } from './reports.js';

export function createApp({ database, distPath, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
  const unavailable = (res, error) => {
    logger.error(`Database request failed: ${error.code || 'UNKNOWN'}`);
    if (error.code === 'ER_QUERY_TIMEOUT' || error.errno === 3024) return sendError(res, 504, 'QUERY_TIMEOUT', 'The warehouse query timed out. Try a smaller month range.');
    return sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Cannot load warehouse data. Check MySQL, the schema, and the backend .env settings.');
  };
  app.get('/api/health', async (req, res) => {
    try {
      const [row] = await database.query('SELECT DATABASE() AS database_name, @@port AS database_port');
      res.json({ status: 'ready', source: 'warehouse', database: row.database_name, port: Number(row.database_port) });
    } catch (error) { unavailable(res, error); }
  });
  app.get('/api/reports/:report', async (req, res) => {
    const report = req.params.report;
    if (report === 'optimization') return sendError(res, 501, 'REPORT_WIP', 'Optimization comparison is WIP. No measurements have been published.');
    if (!LIVE_REPORTS.includes(report)) return sendError(res, 404, 'REPORT_NOT_FOUND', 'That report is not available.');
    let filters;
    try { filters = parseFilters(new URL(req.originalUrl, 'http://localhost').searchParams); }
    catch (error) { return sendError(res, 400, 'INVALID_FILTERS', error.message); }
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
      const query = buildReportQuery(report, filters, database.queryTimeoutMs);
      const started = performance.now();
      const rows = await database.query(query.sql, query.values, controller.signal);
      if (!controller.signal.aborted) res.json(formatReport(report, filters, rows, performance.now() - started));
    } catch (error) { if (!controller.signal.aborted) unavailable(res, error); }
    finally { res.off('close', onClose); }
  });
  app.use('/api', (req, res) => sendError(res, 404, 'NOT_FOUND', 'API endpoint not found.'));
  if (distPath && existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: distPath }));
  }
  return app;
}