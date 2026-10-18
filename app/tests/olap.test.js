import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOlapQuery, formatOlap } from '../server/olap.js';
import { describeSelection, parseOlapRequest } from '../src/lib/olap.js';

const request = (operation, query = '') => parseOlapRequest(operation, new URLSearchParams(query));

test('hierarchy query drills one level, binds the path and uses window functions', () => {
  const req = request('hierarchy', `dimension=location&path=${encodeURIComponent('["Manhattan"]')}&boroughs=Manhattan,Queens`);
  const query = buildOlapQuery('hierarchy', req);
  assert.match(query.sql, /l\.service_zone AS member/);
  assert.match(query.sql, /RANK\(\) OVER/);
  assert.deepEqual(query.values, ['Manhattan', '2025-01-01', '2025-04-01', 'Manhattan', 'Queens']);
  assert.ok(!/JOIN dim_date/.test(query.sql));
});

test('rollup query uses WITH ROLLUP and GROUPING and formats subtotals', () => {
  const req = request('rollup', 'dimension=time&depth=3');
  const query = buildOlapQuery('rollup', req);
  assert.match(query.sql, /GROUP BY d\.year, d\.quarter, d\.month WITH ROLLUP/);
  assert.match(query.sql, /GROUPING\(d\.month\) AS g2/);
  const row = (k, g, trips) => ({ k0: k[0], k1: k[1], k2: k[2], g0: g[0], g1: g[1], g2: g[2], trips, revenue: trips * 10, avg_fare: 5 });
  const rows = [row([2025, null, null], [0, 1, 1], 30), row([null, null, null], [1, 1, 1], 30), row([2025, 1, 1], [0, 0, 0], 10), row([2025, 1, 2], [0, 0, 0], 20), row([2025, 1, null], [0, 0, 1], 30)];
  const out = formatOlap('rollup', req, query, rows, 5);
  assert.deepEqual(out.rows.map((r) => [r.kind, r.label]), [['detail', 'January'], ['detail', 'February'], ['subtotal', 'Q1'], ['subtotal', '2025'], ['grand', 'Grand total']]);
  assert.ok(Math.abs(out.rows[0].shareOfParent - 100 / 3) < 1e-9);
});

test('pivot query uses conditional aggregation over whitelisted dimensions', () => {
  const req = request('pivot', 'rows=borough&columns=payment&measure=revenue&endMonth=2');
  const query = buildOlapQuery('pivot', req);
  assert.match(query.sql, /SUM\(CASE WHEN CASE WHEN f\.payment_sk = 1/);
  assert.match(query.sql, /WITH ROLLUP/);
  assert.deepEqual(query.values.slice(0, 3), ['card', 'cash', 'other']);
  const out = formatOlap('pivot', req, query, [{ row_key: 'Queens', row_g: 0, c0: '5.5', c1: null, c2: null, row_total: '5.5' }, { row_key: null, row_g: 1, c0: '5.5', c1: null, c2: null, row_total: '5.5' }], 1);
  assert.equal(out.body.length, 1);
  assert.deepEqual(out.grand.cells, [5.5, 0, 0]);
});

test('olap requests reject invalid input and describe slice vs dice', () => {
  for (const [op, q] of [['pivot', 'rows=borough&columns=borough'], ['pivot', 'rows=zone'], ['rollup', 'depth=9'], ['hierarchy', 'path=%5B1%5D&dimension=bogus'], ['hierarchy', `path=${encodeURIComponent('[2025,1,1,"2025-01-01"]')}`], ['hierarchy', 'boroughs=Gotham']]) assert.throws(() => request(op, q), op + q);
  assert.equal(describeSelection(request('hierarchy', 'startMonth=1&endMonth=12').filters).kind, 'cube');
  assert.equal(describeSelection(request('hierarchy', 'startMonth=1&endMonth=12&boroughs=Queens').filters).kind, 'slice');
  assert.equal(describeSelection(request('hierarchy', 'startMonth=1&endMonth=12&boroughs=Queens,Bronx').filters).kind, 'dice');
});
