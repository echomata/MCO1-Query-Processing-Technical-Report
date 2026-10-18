// Opt-in, read-only SQL equivalence checks and January performance comparison.
// CTE fixtures shadow table names only inside each SELECT; no tables are created.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../server/database.js';
import { buildReportQuery, formatReport, LIVE_REPORTS } from '../server/reports.js';
import { DEFAULT_FILTERS } from '../src/lib/config.js';
import { buildBaselineReportQuery } from './lib/baseline-reports.js';
import { DASHBOARD_COVER_INDEX } from '../server/dashboardIndex.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--fixtures-only', '--covering'].includes(arg) && !/^--runs=[1-5]$/.test(arg))) {
  throw new Error('Usage: npm run benchmark:reports -- [--fixtures-only] [--covering] [--runs=1..5]');
}
const runs = Number(args.find((arg) => arg.startsWith('--runs='))?.split('=')[1] || 1);
const coveringMode = args.includes('--covering');
const buildCoveringReportQuery = (report, filters, timeout) =>
  buildReportQuery(report, filters, timeout, { useCoveringIndex: true });
process.loadEnvFile(fileURLToPath(new URL('../server/.env', import.meta.url)));
const database = createDatabase();

const fixture = `WITH fact_trip AS (
  SELECT CAST('2024-12-31 23:59:59' AS DATETIME) AS pickup_datetime,
    1 AS pu_location_sk, 1 AS payment_sk,
    CAST(999.99 AS DECIMAL(10,2)) AS total_amount,
    CAST(800.00 AS DECIMAL(10,2)) AS fare_amount,
    CAST(1.11 AS DECIMAL(10,2)) AS trip_distance, 10 AS duration_min
  UNION ALL SELECT '2025-01-01 00:00:00', 1, 1, 100.11, 80.22, 1.11, 10
  UNION ALL SELECT '2025-01-01 00:01:00', 1, 1, -10.11, -8.22, 0.00, 0
  UNION ALL SELECT '2025-01-02 12:00:00', 2, 2, 25.00, 20.00, 2.50, 20
  UNION ALL SELECT '2025-01-31 23:59:59', 3, -1, 12.34, 10.12, 3.00, 30
  UNION ALL SELECT '2025-01-03 12:00:00', 4, 3, -5.01, -4.02, 0.00, 0
  UNION ALL SELECT '2025-01-04 12:00:00', 3, 4, 8.01, 6.02, 1.00, 5
  UNION ALL SELECT '2025-02-01 00:00:00', 1, 1, 40.00, 30.00, 4.00, 40
  UNION ALL SELECT '2025-03-31 23:59:59', 4, 0, 5.00, 3.00, 1.00, 5
  UNION ALL SELECT '2025-04-01 00:00:00', 3, 5, 7.00, 5.00, 2.00, 6
  UNION ALL SELECT '2025-12-31 23:59:59', 3, 6, 1.00, 1.00, 1.00, 1
  UNION ALL SELECT '2026-01-01 00:00:00', 1, 1, 999.99, 800.00, 1.11, 10
), dim_location AS (
  SELECT 1 AS location_sk, 'Midtown' AS zone, 'Manhattan' AS borough
  UNION ALL SELECT 2, 'Midtown', 'Queens'
  UNION ALL SELECT 3, 'N/A', 'Unknown'
  UNION ALL SELECT 4, 'St. George', 'Staten Island'
  UNION ALL SELECT 5, 'Newark', 'EWR'
) `;

function near(actual, expected, field) {
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${field}: ${actual} != ${expected}`);
}
function compareReports(actual, expected) {
  assert.equal(actual.summary.totalTrips, expected.summary.totalTrips);
  assert.equal(Math.round(actual.summary.totalRevenue * 100), Math.round(expected.summary.totalRevenue * 100));
  for (const field of ['averageFare', 'averageDistance', 'averageDuration']) near(actual.summary[field], expected.summary[field], field);
  for (const section of ['series', 'boroughs']) {
    assert.equal(actual[section].length, expected[section].length, section);
    const expectedRows = new Map(expected[section].map((row) => [row.key, row]));
    for (const row of actual[section]) {
      const other = expectedRows.get(row.key);
      assert.ok(other, `Missing ${section} key ${row.key}`);
      assert.equal(row.label, other.label);
      assert.equal(row.trips, other.trips);
      assert.equal(Math.round(row.revenue * 100), Math.round(other.revenue * 100));
      near(row.averageFare, other.averageFare, 'averageFare');
      near(row.share, other.share, 'share');
    }
  }
}
async function queryReport(builder, report, filters, useFixture = false) {
  const query = builder(report, filters, database.queryTimeoutMs);
  // CTE fixtures have no physical indexes. Live comparisons retain the real hint.
  const sql = useFixture ? fixture + query.sql.replace(/ FORCE INDEX \(idx_(?:pickup_ts|dashboard_cover_v1)\)/g, '') : query.sql;
  const started = performance.now();
  const rows = await database.query(sql, query.values);
  const ms = performance.now() - started;
  return { ms, result: formatReport(report, filters, rows, ms, query.version) };
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
function factAccess(plan) {
  const tables = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.table_name === 'f') tables.push({ access: value.access_type, index: value.key || null, covering: !!value.using_index, estimatedRows: value.rows_examined_per_scan });
    for (const child of Object.values(value)) visit(child);
  };
  visit(plan);
  return tables;
}
try {
  const selections = [
    {}, { paymentType: 'card' }, { paymentType: 'cash' }, { paymentType: 'other' },
    { borough: 'Staten Island' }, { borough: 'Unknown' }, { borough: 'EWR' },
    { endMonth: 3, granularity: 'quarter' }, { endMonth: 12, granularity: 'year' },
    { endMonth: 12, paymentType: 'other' },
    { startMonth: 2, endMonth: 2 }, { startMonth: 10, endMonth: 10 },
  ];
  let checked = 0;
  for (const input of selections) {
    const filters = { ...DEFAULT_FILTERS, ...input };
    for (const report of LIVE_REPORTS) {
      const expected = await queryReport(buildBaselineReportQuery, report, filters, true);
      for (const builder of [buildReportQuery, buildCoveringReportQuery]) {
        const actual = await queryReport(builder, report, filters, true);
        compareReports(actual.result, expected.result);
        if (!Object.keys(input).length) {
          assert.equal(actual.result.summary.totalTrips, 6);
          assert.equal(actual.result.summary.totalRevenue, 130.34);
          near(actual.result.summary.averageFare, 104.12 / 6, 'independent expected fare');
          if (report === 'locations') assert.equal(actual.result.series.filter((row) => row.label === 'Midtown').length, 2);
        }
        checked++;
      }
    }
  }
  console.log(JSON.stringify({ event: 'fixture-validation', passed: checked, coverage: 'month boundaries, refunds, weighted averages, unknown/payment codes, duplicate zone labels, empty selections, borough/payment filters, quarter/year ranges' }));
  if (!args.includes('--fixtures-only')) {
    const filters = { ...DEFAULT_FILTERS };
    const indexReady = await database.dashboardIndexReady();
    if (coveringMode && !indexReady) throw new Error('Install the invisible dashboard index before running --covering.');
    const before = coveringMode ? buildReportQuery : buildBaselineReportQuery;
    const after = indexReady ? buildCoveringReportQuery : buildReportQuery;
    console.log(JSON.stringify({ event: 'benchmark-start', at: new Date().toISOString(), runs, filters, coveringMode, indexReady, note: 'Run against an unchanged warehouse without other heavy queries. No result cache or database writes.' }));
    for (const report of ['overview', 'locations', 'payments']) {
      const timings = { baseline: [], optimized: [] };
      const plans = {};
      let latest;
      for (let run = 0; run < runs; run++) {
        const results = {};
        const variants = run % 2 ? ['optimized', 'baseline'] : ['baseline', 'optimized'];
        for (const variant of variants) {
          const builder = variant === 'baseline' ? before : after;
          if (!plans[variant]) {
            const query = builder(report, filters, database.queryTimeoutMs);
            const [plan] = await database.query('EXPLAIN FORMAT=JSON ' + query.sql, query.values);
            plans[variant] = factAccess(JSON.parse(plan.EXPLAIN));
            if (coveringMode && variant === 'optimized') assert.ok(plans[variant].some((p) => p.index === DASHBOARD_COVER_INDEX && p.covering), 'The candidate is not using a covering access path.');
          }
          console.log(JSON.stringify({ event: 'query-start', report, variant, run: run + 1 }));
          results[variant] = await queryReport(builder, report, filters);
          timings[variant].push(results[variant].ms);
        }
        compareReports(results.optimized.result, results.baseline.result);
        latest = results.optimized.result;
      }
      const baselineMs = median(timings.baseline);
      const optimizedMs = median(timings.optimized);
      console.log(JSON.stringify({
        event: 'benchmark-result', report: report === 'overview' ? 'overview/time' : report,
        equivalent: true, runs, baselineMs: Math.round(baselineMs), optimizedMs: Math.round(optimizedMs),
        reductionPct: Number((100 * (1 - optimizedMs / baselineMs)).toFixed(1)), plans,
        samplesMs: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, values.map(Math.round)])),
        summary: latest.summary, groups: latest.series.length,
      }));
    }
  }
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : `Dashboard verification failed: ${error.code || error.name}`);
  process.exitCode = 1;
} finally { await database.close(); }
