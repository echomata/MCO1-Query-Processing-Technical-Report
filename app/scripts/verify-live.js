// Explicit, read-only smoke check against the configured populated warehouse.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';

process.loadEnvFile(fileURLToPath(new URL('../server/.env', import.meta.url)));
const database = createDatabase();
const server = createApp({ database }).listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.status, 'ready');
  console.log('Warehouse connection:', health.status);
  const filters = 'year=2025&startMonth=1&endMonth=1&borough=Staten+Island&paymentType=all&granularity=month';
  const [expected] = await database.query(`SELECT /*+ MAX_EXECUTION_TIME(180000) */ COUNT(*) AS trips,
    SUM(f.total_amount) AS revenue, AVG(f.fare_amount) AS fare,
    AVG(f.trip_distance) AS distance, AVG(f.duration_min) AS duration
    FROM fact_trip f JOIN dim_location l ON l.location_sk=f.pu_location_sk
    WHERE f.pickup_datetime >= ? AND f.pickup_datetime < ? AND l.borough=?`, ['2025-01-01', '2025-02-01', 'Staten Island']);
  let common;
  for (const report of ['overview', 'time', 'locations', 'payments']) {
    const response = await fetch(`${base}/api/reports/${report}?${filters}`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.meta.source, 'warehouse');
    assert.equal(body.summary.totalTrips, Number(expected.trips));
    assert.ok(Math.abs(body.summary.totalRevenue - Number(expected.revenue || 0)) < 0.001);
    for (const [key, sqlKey] of [['averageFare', 'fare'], ['averageDistance', 'distance'], ['averageDuration', 'duration']]) assert.ok(Math.abs(body.summary[key] - Number(expected[sqlKey] || 0)) < 0.00001);
    assert.equal(body.series.reduce((sum, row) => sum + row.trips, 0), body.summary.totalTrips);
    assert.equal(body.boroughs.reduce((sum, row) => sum + row.trips, 0), body.summary.totalTrips);
    if (common) assert.deepEqual(body.summary, common);
    common = body.summary;
    console.log(`${report}: ${body.summary.totalTrips} trips, ${body.series.length} groups, ${body.meta.queryMs} ms, reconciled to direct SQL`);
  }
  for (const granularity of ['quarter', 'year']) {
    const response = await fetch(`${base}/api/reports/time?${filters.replace('granularity=month', `granularity=${granularity}`)}`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.summary, common);
    assert.equal(body.series[0].label, granularity === 'quarter' ? 'Q1' : '2025');
    console.log(`${granularity} roll-up: matches monthly summary`);
  }
} finally {
  server.closeAllConnections(); server.close(); await database.close();
}