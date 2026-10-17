import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getReport, validateFilters } from '../src/services/reportService.js';
import { DEFAULT_FILTERS } from '../src/lib/config.js';
import { formatReport } from '../server/reports.js';

test('live requests encode filters and accept only warehouse results', async () => {
  const filters = { ...DEFAULT_FILTERS, borough: 'Staten Island', startMonth: 2, endMonth: 3 };
  const expected = formatReport('overview', filters, [], 12);
  const result = await getReport('overview', filters, { fetchImpl: async (url) => {
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.pathname, '/api/reports/overview');
    assert.equal(parsed.searchParams.get('borough'), 'Staten Island');
    assert.equal(parsed.searchParams.get('startMonth'), '2');
    return Response.json(expected);
  } });
  assert.deepEqual(result, expected);
});

test('unavailable API and sample responses never fall back to mock data', async () => {
  await assert.rejects(getReport('overview', {}, { fetchImpl: async () => { throw new Error('offline'); } }), /Cannot reach the API/);
  await assert.rejects(getReport('overview', {}, { fetchImpl: async () => Response.json({ meta: { source: 'mock' } }) }), /Live warehouse results/);
  await assert.rejects(getReport('overview', {}, { fetchImpl: async () => Response.json({ error: { message: 'Database offline' } }, { status: 503 }) }), /Database offline/);
  await assert.rejects(getReport('overview', {}, { fetchImpl: async () => new Response('<html>') }), /did not return JSON/);
  await assert.rejects(getReport('overview', {}, { fetchImpl: async () => Response.json({ report: 'overview', meta: { source: 'warehouse', status: 'ready' } }) }), /incomplete/);
});

test('WIP has no figures and makes no request', async () => {
  const result = await getReport('optimization', {}, { fetchImpl: () => assert.fail('WIP should not fetch') });
  assert.equal(result.meta.status, 'wip');
  assert.equal(result.meta.source, null);
  assert.equal(result.summary, undefined);
});

test('invalid filters are rejected before the request', async () => {
  assert.throws(() => validateFilters({ startMonth: 8, endMonth: 2 }), /starting month/);
  assert.throws(() => validateFilters({ borough: "Queens' OR 1=1" }), /borough/);
  assert.throws(() => validateFilters({ granularity: 'day' }), /time level/);
  await assert.rejects(getReport('invalid'), /not available/);
});

test('cancelled requests preserve AbortError', async () => {
  const controller = new AbortController();
  const request = getReport('overview', DEFAULT_FILTERS, { signal: controller.signal, fetchImpl: async (url, { signal }) => {
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});