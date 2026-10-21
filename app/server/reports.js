import { MONTHS, PAYMENTS } from '../src/lib/config.js';
import { DASHBOARD_COVER_INDEX } from './dashboardIndex.js';

export const LIVE_REPORTS = ['overview', 'time', 'locations', 'payments'];

// One SELECT per request; every displayed measure uses the same filtered rows.
export function buildReportQuery(report, filters, timeoutMs = 180_000, { useCoveringIndex = false } = {}) {
  if (!LIVE_REPORTS.includes(report)) throw new Error('Unknown live report');
  const period = { month: 'MONTH(f.pickup_datetime)', quarter: 'QUARTER(f.pickup_datetime)', year: 'YEAR(f.pickup_datetime)' }[filters.granularity];
  const payment = "CASE WHEN f.payment_sk = 1 THEN 'card' WHEN f.payment_sk = 2 THEN 'cash' ELSE 'other' END";
  const groupKey = report === 'locations' ? 'l.location_sk' : report === 'payments' ? payment : period;
  const groupLabel = report === 'locations' ? 'l.zone' : groupKey;
  const start = `${filters.year}-${String(filters.startMonth).padStart(2, '0')}-01`;
  const end = filters.endMonth === 12 ? `${filters.year + 1}-01-01` : `${filters.year}-${String(filters.endMonth + 1).padStart(2, '0')}-01`;
  const conditions = ['f.pickup_datetime >= ?', 'f.pickup_datetime < ?'];
  const values = [start, end];
  if (filters.borough !== 'all') { conditions.push('l_filter.borough = ?'); values.push(filters.borough); }
  if (filters.paymentType === 'card' || filters.paymentType === 'cash') {
    conditions.push('f.payment_sk = ?'); values.push(filters.paymentType === 'card' ? 1 : 2);
  } else if (filters.paymentType === 'other') conditions.push('f.payment_sk NOT IN (1, 2)');
  const maxMs = Math.max(1, Math.trunc(timeoutMs));
  // SET_VAR applies only to this SELECT, including its derived table. It does
  // not enable invisible indexes on the pooled session or on OLAP statements.
  const hint = `/*+ MAX_EXECUTION_TIME(${maxMs})${useCoveringIndex ? " SET_VAR(optimizer_switch='use_invisible_indexes=on')" : ''} */`;
  const version = useCoveringIndex ? 'dashboard-v3-covering' : 'dashboard-v2';
  if (filters.borough === 'all') {
    // Reduce millions of trips to period/payment and pickup-zone groups
    // before looking up location labels. SUM the counts, never AVG the averages.
    const factKey = report === 'locations' ? 'f.pu_location_sk' : groupKey;
    // Measured on the populated warehouse: the optimizer otherwise scans the
    // entire fact table for a single month. Without the covering index, keep
    // its choice for wider ranges.
    const index = useCoveringIndex ? ` FORCE INDEX (${DASHBOARD_COVER_INDEX})`
      : filters.startMonth === filters.endMonth ? ' FORCE INDEX (idx_pickup_ts)' : '';
    return {
      sql: `SELECT ${hint}
        a.group_key, ${report === 'locations' ? 'l.zone' : 'a.group_key'} AS group_label, l.borough,
        SUM(a.trips) AS trips,
        SUM(a.revenue_cents) AS revenue_cents,
        SUM(a.fare_cents) AS fare_cents,
        SUM(a.distance_total) AS distance_total,
        SUM(a.duration_total) AS duration_total
      FROM (
        SELECT ${factKey} AS group_key, f.pu_location_sk,
          COUNT(*) AS trips,
          SUM(f.total_amount) * 100 AS revenue_cents,
          SUM(f.fare_amount) * 100 AS fare_cents,
          SUM(f.trip_distance) AS distance_total,
          SUM(f.duration_min) AS duration_total
        FROM fact_trip f${index}
        WHERE ${conditions.join(' AND ')}
        GROUP BY group_key, f.pu_location_sk
      ) a
      JOIN dim_location l ON l.location_sk = a.pu_location_sk
      GROUP BY a.group_key, group_label, l.borough`,
      values, version,
    };
  }
  const boroughFactKey = report === 'locations' ? 'f.pu_location_sk' : groupKey;
  const boroughGroupLabel = report === 'locations' ? 'l_filter.zone' : groupKey;
  const boroughIndex = useCoveringIndex ? ` FORCE INDEX (${DASHBOARD_COVER_INDEX})`
    : filters.startMonth === filters.endMonth ? ' FORCE INDEX (idx_pickup_ts)' : '';
  return {
    sql: `SELECT ${hint}
      a.group_key, a.group_label, a.borough,
      SUM(a.trips) AS trips,
      SUM(a.revenue_cents) AS revenue_cents,
      SUM(a.fare_cents) AS fare_cents,
      SUM(a.distance_total) AS distance_total,
      SUM(a.duration_total) AS duration_total
    FROM (
      SELECT ${boroughFactKey} AS group_key, ${boroughGroupLabel} AS group_label,
        l_filter.borough AS borough, f.pu_location_sk,
        COUNT(*) AS trips,
        SUM(f.total_amount) * 100 AS revenue_cents,
        SUM(f.fare_amount) * 100 AS fare_cents,
        SUM(f.trip_distance) AS distance_total,
        SUM(f.duration_min) AS duration_total
      FROM fact_trip f${boroughIndex}
      JOIN dim_location l_filter ON l_filter.location_sk = f.pu_location_sk
      WHERE ${conditions.join(' AND ')}
      GROUP BY group_key, group_label, l_filter.borough, f.pu_location_sk
    ) a
    GROUP BY a.group_key, a.group_label, a.borough`,
    values, version,
  };
}

const emptyTotals = () => ({ trips: 0, revenueCents: 0, fareCents: 0, distance: 0, duration: 0 });
function add(total, row) {
  total.trips += Number(row.trips);
  total.revenueCents += Number(row.revenue_cents);
  total.fareCents += Number(row.fare_cents);
  total.distance += Number(row.distance_total);
  total.duration += Number(row.duration_total);
}

export function formatReport(report, filters, rows, queryMs, queryVersion = 'dashboard-v2') {
  const total = emptyTotals();
  const series = new Map();
  const boroughs = new Map();
  for (const row of rows) {
    add(total, row);
    const key = String(row.group_key);
    if (!series.has(key)) series.set(key, { ...emptyTotals(), key: row.group_key, label: row.group_label });
    add(series.get(key), row);
    if (!boroughs.has(row.borough)) boroughs.set(row.borough, { ...emptyTotals(), key: row.borough, label: row.borough });
    add(boroughs.get(row.borough), row);
  }
  const measures = (row) => ({
    key: row.key, label: String(row.label), trips: row.trips,
    revenue: row.revenueCents / 100,
    averageFare: row.trips ? row.fareCents / 100 / row.trips : 0,
    share: total.trips ? row.trips / total.trips * 100 : 0,
  });
  const timeReport = report === 'overview' || report === 'time';
  const output = [...series.values()].map((row) => {
    if (timeReport) row.label = filters.granularity === 'year' ? String(row.key) : filters.granularity === 'quarter' ? `Q${row.key}` : MONTHS[Number(row.key) - 1].slice(0, 3);
    if (report === 'payments') row.label = PAYMENTS.find((p) => p.id === row.key)?.label || String(row.key);
    return measures(row);
  }).sort((a, b) => timeReport ? Number(a.key) - Number(b.key) : b.trips - a.trips || a.label.localeCompare(b.label));
  return {
    report, filters,
    summary: {
      totalTrips: total.trips, totalRevenue: total.revenueCents / 100,
      averageFare: total.trips ? total.fareCents / 100 / total.trips : 0,
      averageDistance: total.trips ? total.distance / total.trips : 0,
      averageDuration: total.trips ? total.duration / total.trips : 0,
    },
    series: output,
    boroughs: [...boroughs.values()].map(measures).sort((a, b) => b.trips - a.trips),
    meta: { source: 'warehouse', status: 'ready', currency: 'USD', year: filters.year,
      generatedAt: new Date().toISOString(), queryMs: Math.round(queryMs), queryVersion,
      dateBasis: 'pickup_datetime', revenueBasis: 'SUM(total_amount)' },
  };
}
