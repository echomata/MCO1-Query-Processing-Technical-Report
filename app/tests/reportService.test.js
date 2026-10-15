import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockReport, getReport } from '../src/services/reportService.js';
import { DEFAULT_FILTERS } from '../src/lib/config.js';

test('every report reconciles to the same summary total', () => {
  for (const id of ['overview', 'time', 'locations', 'payments']) {
    const result = buildMockReport(id);
    assert.equal(result.series.reduce((sum, row) => sum + row.trips, 0), result.summary.totalTrips);
    assert.equal(result.series.reduce((sum, row) => sum + Math.round(row.revenue * 100), 0), Math.round(result.summary.totalRevenue * 100));
  }
});

test('quarter and year roll-ups preserve monthly totals', () => {
  const monthly = buildMockReport();
  for (const granularity of ['quarter', 'year']) {
    const rolled = buildMockReport('time', { granularity });
    assert.equal(rolled.series.length, granularity === 'quarter' ? 4 : 1);
    assert.deepEqual(rolled.summary, monthly.summary);
    assert.equal(rolled.series.reduce((sum, row) => sum + row.trips, 0), monthly.summary.totalTrips);
  }
});

test('multiple filters intersect and all measures use that same selection', () => {
  const result = buildMockReport('payments', { startMonth: 2, endMonth: 3, borough: 'Queens', paymentType: 'cash' });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].key, 'cash');
  assert.equal(result.boroughs.length, 1);
  assert.equal(result.boroughs[0].key, 'Queens');
  assert.ok(result.summary.totalTrips < buildMockReport().summary.totalTrips);
  assert.equal(buildMockReport('time', result.filters).series.length, 2);
});

test('weighted fare averages reconcile across time groups', () => {
  const result = buildMockReport();
  const weighted = result.series.reduce((sum, row) => sum + row.averageFare * row.trips, 0) / result.summary.totalTrips;
  assert.ok(Math.abs(weighted - result.summary.averageFare) < 0.000001);
});

test('invalid filter values and reports are rejected', () => {
  assert.throws(() => buildMockReport('overview', { startMonth: 8, endMonth: 2 }), /starting month/);
  assert.throws(() => buildMockReport('overview', { borough: 'Invalid' }), /borough/);
  assert.throws(() => buildMockReport('overview', { granularity: 'day' }), /time level/);
  assert.throws(() => buildMockReport('invalid'), /not available/);
});

test('cancelled requests never resolve a stale report', async () => {
  const controller = new AbortController();
  const request = getReport('overview', DEFAULT_FILTERS, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});