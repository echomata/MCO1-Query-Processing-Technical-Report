// Frozen pre-optimization dashboard SQL for read-only before/after checks.
// This module is used only by the benchmark script, never by the running API.
export function buildBaselineReportQuery(report, filters, timeoutMs = 180_000) {
  const period = { month: 'MONTH(f.pickup_datetime)', quarter: 'QUARTER(f.pickup_datetime)', year: 'YEAR(f.pickup_datetime)' }[filters.granularity];
  const payment = "CASE WHEN f.payment_sk = 1 THEN 'card' WHEN f.payment_sk = 2 THEN 'cash' ELSE 'other' END";
  const groupKey = report === 'locations' ? 'l.location_sk' : report === 'payments' ? payment : period;
  const groupLabel = report === 'locations' ? 'l.zone' : groupKey;
  const join = filters.borough === 'all' ? 'STRAIGHT_JOIN' : 'JOIN';
  const start = `${filters.year}-${String(filters.startMonth).padStart(2, '0')}-01`;
  const end = filters.endMonth === 12 ? `${filters.year + 1}-01-01` : `${filters.year}-${String(filters.endMonth + 1).padStart(2, '0')}-01`;
  const conditions = ['f.pickup_datetime >= ?', 'f.pickup_datetime < ?'];
  const values = [start, end];
  if (filters.borough !== 'all') { conditions.push('l.borough = ?'); values.push(filters.borough); }
  if (filters.paymentType === 'card' || filters.paymentType === 'cash') {
    conditions.push('f.payment_sk = ?'); values.push(filters.paymentType === 'card' ? 1 : 2);
  } else if (filters.paymentType === 'other') conditions.push('f.payment_sk NOT IN (1, 2)');
  const maxMs = Math.max(1, Math.trunc(timeoutMs));
  return {
    sql: `SELECT /*+ MAX_EXECUTION_TIME(${maxMs}) */
      ${groupKey} AS group_key, ${groupLabel} AS group_label, l.borough,
      COUNT(*) AS trips,
      SUM(f.total_amount) * 100 AS revenue_cents,
      SUM(f.fare_amount) * 100 AS fare_cents,
      SUM(f.trip_distance) AS distance_total,
      SUM(f.duration_min) AS duration_total
    FROM fact_trip f
    ${join} dim_location l ON l.location_sk = f.pu_location_sk
    WHERE ${conditions.join(' AND ')}
    GROUP BY group_key, group_label, l.borough`,
    values,
  };
}
