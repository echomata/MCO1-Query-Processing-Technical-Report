export const DASHBOARD_COVER_INDEX = 'idx_dashboard_cover_v1';
export const DASHBOARD_COVER_COLUMNS = [
  'pickup_datetime', 'pu_location_sk', 'payment_sk',
  'total_amount', 'fare_amount', 'trip_distance', 'duration_min',
];
export const CREATE_DASHBOARD_INDEX_SQL = `ALTER TABLE fact_trip
  ADD INDEX ${DASHBOARD_COVER_INDEX} (${DASHBOARD_COVER_COLUMNS.join(', ')}) INVISIBLE,
  ALGORITHM=INPLACE, LOCK=NONE`;

// A partial, differently ordered or visible index does not enable this feature.
export function isDashboardIndexReady(rows) {
  const parts = [...rows].sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index));
  return parts.length === DASHBOARD_COVER_COLUMNS.length && parts.every((part, i) =>
    part.Key_name === DASHBOARD_COVER_INDEX
    && part.Column_name === DASHBOARD_COVER_COLUMNS[i]
    && Number(part.Seq_in_index) === i + 1
    && part.Sub_part == null && Number(part.Non_unique) === 1
    && part.Index_type === 'BTREE' && part.Visible === 'NO');
}

// Share a small metadata lookup across dashboard requests. This never changes
// session/global optimizer settings, creates indexes or runs on the OLAP route.
export function createDashboardIndexProbe(query, { now = Date.now, ttlMs = 30_000 } = {}) {
  let expiresAt = 0;
  let ready = false;
  let pending;
  return async () => {
    if (now() < expiresAt) return ready;
    if (!pending) {
      pending = query('SHOW INDEX FROM fact_trip WHERE Key_name = ?', [DASHBOARD_COVER_INDEX])
        .then((rows) => { ready = isDashboardIndexReady(rows); expiresAt = now() + ttlMs; return ready; })
        .finally(() => { pending = undefined; });
    }
    return pending;
  };
}
