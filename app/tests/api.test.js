import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { buildReportQuery, formatReport } from '../server/reports.js';
import { DEFAULT_FILTERS } from '../src/lib/config.js';
import { parseFilters } from '../src/lib/reportFilters.js';

const rows = [
  { group_key: 1, group_label: 1, borough: 'Queens', trips: '2', revenue_cents: '5000', fare_cents: '4000', distance_total: '8', duration_total: '40' },
  { group_key: 1, group_label: 1, borough: 'Manhattan', trips: '1', revenue_cents: '-500', fare_cents: '-400', distance_total: '1', duration_total: '5' },
  { group_key: 2, group_label: 2, borough: 'Unknown', trips: '7', revenue_cents: '21000', fare_cents: '14000', distance_total: '21', duration_total: '70' },
];

test('aggregated summary preserves refunds, unknown zones, cents, and weighted averages', () => {
  const report = formatReport('overview', DEFAULT_FILTERS, rows, 21);
  assert.equal(report.summary.totalTrips, 10);
  assert.equal(report.summary.totalRevenue, 255);
  assert.equal(report.summary.averageFare, 17.6);
  assert.equal(report.summary.averageDistance, 3);
  assert.equal(report.summary.averageDuration, 11.5);
  assert.deepEqual(report.series.map((r) => r.label), ['Jan', 'Feb']);
  assert.equal(report.series.reduce((sum, r) => sum + r.trips, 0), 10);
  assert.equal(report.series.reduce((sum, r) => sum + r.revenue, 0), 255);
  assert.equal(report.boroughs.length, 3);
  const weighted = report.series.reduce((sum, r) => sum + r.averageFare * r.trips, 0) / 10;
  assert.equal(weighted, 17.6);
  assert.ok(!JSON.stringify(report).includes('mock'));
});

test('empty results are genuine zero measures, with no example values', () => {
  const report = formatReport('overview', DEFAULT_FILTERS, [], 0);
  assert.deepEqual(report.summary, { totalTrips: 0, totalRevenue: 0, averageFare: 0, averageDistance: 0, averageDuration: 0 });
  assert.deepEqual(report.series, []);
  assert.deepEqual(report.boroughs, []);
});

test('query binds exclusive date bounds, borough and payment, and allows only fixed dimensions', () => {
  const query = buildReportQuery('time', { ...DEFAULT_FILTERS, startMonth: 2, endMonth: 3, borough: 'Queens', paymentType: 'cash', granularity: 'quarter' });
  assert.deepEqual(query.values, ['2025-02-01', '2025-04-01', 'Queens', 2]);
  assert.match(query.sql, /QUARTER\(f.pickup_datetime\)/);
  assert.ok(!query.sql.includes('Queens'));
  assert.match(query.sql, /SUM\(f.total_amount\)/);
  assert.deepEqual(buildReportQuery('overview', { ...DEFAULT_FILTERS, endMonth: 12 }).values, ['2025-01-01', '2026-01-01']);
  assert.match(buildReportQuery('overview', DEFAULT_FILTERS).sql, /STRAIGHT_JOIN/);
  assert.ok(!query.sql.includes('STRAIGHT_JOIN'));
  assert.match(buildReportQuery('payments', { ...DEFAULT_FILTERS, paymentType: 'other' }).sql, /NOT IN \(1, 2\)/);
  assert.match(buildReportQuery('locations', DEFAULT_FILTERS).sql, /l.location_sk AS group_key/);
  assert.throws(() => buildReportQuery('unknown', DEFAULT_FILTERS));
  for (const params of ['year=2024', 'startMonth=0', 'startMonth=2&startMonth=3', 'sort=DROP', 'paymentType=9', 'borough=Invalid']) assert.throws(() => parseFilters(new URLSearchParams(params)));
});

test('HTTP contract: live JSON, validation, WIP, unavailable DB and timeouts', async (t) => {
  let calls = 0;
  let failure;
  const database = { queryTimeoutMs: 123000, query: async (sql, params) => {
    calls++;
    if (failure) throw failure;
    if (sql === 'SELECT 1 AS connected') return [{ connected: 1 }];
    assert.deepEqual(params, ['2025-01-01', '2025-02-01']);
    return rows;
  } };
  const server = createApp({ database, logger: { error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${url}/api/health`);
  assert.deepEqual(await health.json(), { status: 'ready', source: 'warehouse' });
  for (const report of ['overview', 'time', 'locations', 'payments']) {
    const response = await fetch(`${url}/api/reports/${report}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.meta.source, 'warehouse');
    assert.equal(body.summary.totalTrips, 10);
  }
  const before = calls;
  assert.equal((await fetch(`${url}/api/reports/overview?startMonth=13`)).status, 400);
  assert.equal((await fetch(`${url}/api/reports/unknown`)).status, 404);
  assert.equal((await fetch(`${url}/api/reports/optimization`)).status, 501);
  assert.equal(calls, before);
  assert.equal((await fetch(`${url}/api/missing`)).status, 404);
  failure = Object.assign(new Error('secret-password'), { code: 'ER_ACCESS_DENIED_ERROR' });
  const unavailable = await fetch(`${url}/api/reports/overview`);
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes('secret-password'));
  failure = Object.assign(new Error('timeout'), { errno: 3024 });
  assert.equal((await fetch(`${url}/api/reports/overview`)).status, 504);
});

test('sharing requires authentication for the website and every API route', async (t) => {
  let calls = 0;
  const database = { query: async () => { calls++; return [{ connected: 1 }]; } };
  const shareAuth = { username: 'test-team', password: 'test-password' };
  const server = createApp({ database, shareAuth }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/assets/app.js', '/api/health', '/api/reports/overview', '/api/missing']) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /^Basic /);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const authorization of ['Basic !!!', 'Bearer test', `Basic ${Buffer.from('test-team:wrong').toString('base64')}`]) {
    assert.equal((await fetch(`${url}/api/health`, { headers: { authorization } })).status, 401);
  }
  assert.equal(calls, 0, 'unauthenticated requests must not reach MySQL');
  const authorization = `Basic ${Buffer.from('test-team:test-password').toString('base64')}`;
  const response = await fetch(`${url}/api/health`, { headers: { authorization } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready', source: 'warehouse' });
  assert.equal(calls, 1);
  assert.throws(() => createApp({ database, shareAuth: { username: 'team' } }));
});