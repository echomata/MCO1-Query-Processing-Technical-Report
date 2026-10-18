import express from 'express';
import { existsSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { parseFilters } from '../src/lib/reportFilters.js';
import { buildReportQuery, formatReport, LIVE_REPORTS } from './reports.js';
import { parseOlapRequest } from '../src/lib/olap.js';
import { buildOlapQuery, formatOlap, OLAP_OPERATIONS } from './olap.js';

export function createApp({ database, distPath, logger = console, shareAuth }) {
  const app = express();
  app.disable('x-powered-by');
  if (shareAuth) {
    if (!shareAuth.username || !shareAuth.password) throw new Error('Sharing requires a username and password.');
    const digest = (value) => createHash('sha256').update(value).digest();
    const expected = digest(`${shareAuth.username}:${shareAuth.password}`);
    app.use((req, res, next) => {
      res.set('Cache-Control', 'no-store');
      const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.get('authorization') || '');
      if (match && timingSafeEqual(digest(Buffer.from(match[1], 'base64')), expected)) return next();
      res.set('WWW-Authenticate', 'Basic realm="Meter team demo", charset="UTF-8"');
      return res.status(401).send('Sign in with the sharing username and password provided by the host.');
    });
  }
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
  const unavailable = (res, error) => {
    logger.error(`Database request failed: ${error.code || 'UNKNOWN'}`);
    if (error.code === 'ER_QUERY_TIMEOUT' || error.errno === 3024) return sendError(res, 504, 'QUERY_TIMEOUT', 'The warehouse query timed out. Try a smaller month range.');
    return sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Cannot load warehouse data. Check MySQL, the schema, and the backend .env settings.');
  };
  app.get('/api/health', async (req, res) => {
    try {
      await database.query('SELECT 1 AS connected');
      res.json({ status: 'ready', source: 'warehouse' });
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
      const useCoveringIndex = await database.dashboardIndexReady?.() ?? false;
      const query = buildReportQuery(report, filters, database.queryTimeoutMs, { useCoveringIndex });
      const started = performance.now();
      const rows = await database.query(query.sql, query.values, controller.signal);
      if (!controller.signal.aborted) res.json(formatReport(report, filters, rows, performance.now() - started, query.version));
    } catch (error) { if (!controller.signal.aborted) unavailable(res, error); }
    finally { res.off('close', onClose); }
  });
  // Results only change when the warehouse is reloaded, so repeat requests within a few minutes are served from memory.
  const olapCache = new Map();
  const OLAP_CACHE_MS = 5 * 60_000;
  const OLAP_CACHE_MAX = 100;
  app.get('/api/olap/:operation', async (req, res) => {
    const operation = req.params.operation;
    if (!OLAP_OPERATIONS.includes(operation)) return sendError(res, 404, 'REPORT_NOT_FOUND', 'That OLAP operation is not available.');
    let request;
    try { request = parseOlapRequest(operation, new URL(req.originalUrl, 'http://localhost').searchParams); }
    catch (error) { return sendError(res, 400, 'INVALID_FILTERS', error.message); }
    const cacheKey = JSON.stringify([operation, request]);
    const hit = olapCache.get(cacheKey);
    if (hit && Date.now() - hit.at < OLAP_CACHE_MS) return res.json({ ...hit.payload, meta: { ...hit.payload.meta, cached: true } });
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
      const query = buildOlapQuery(operation, request, database.queryTimeoutMs);
      const started = performance.now();
      const rows = await database.query(query.sql, query.values, controller.signal);
      if (!controller.signal.aborted) {
        const payload = formatOlap(operation, request, query, rows, performance.now() - started);
        if (olapCache.size >= OLAP_CACHE_MAX) olapCache.delete(olapCache.keys().next().value);
        olapCache.set(cacheKey, { at: Date.now(), payload });
        res.json(payload);
      }
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
