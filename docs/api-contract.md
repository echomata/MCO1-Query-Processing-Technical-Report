# Dashboard API contract

Implemented endpoint: `GET /api/reports/{report}`. The frontend uses relative `/api`
URLs. Vite proxies them during development; `npm start` serves the build and API
on the same local origin. All API responses have `Cache-Control: no-store`.

## Reports and filters

Live report IDs: `overview`, `time`, `locations`, `payments`.
`optimization` is absent from navigation. Its retired API ID retains HTTP 501 /
`REPORT_WIP` for compatibility; performance comparisons belong in the report.
Unknown report IDs return 404. There is no mock mode or fallback.

| Parameter | Default | Meaning |
| --- | --- | --- |
| year | 2025 | Only 2025 pickup dates are currently supported |
| startMonth | 1 | First pickup month, inclusive |
| endMonth | 1 | Last pickup month, inclusive (January default avoids full-year startup scan) |
| borough | all | Pickup borough: Manhattan, Queens, Brooklyn, Bronx, Staten Island, EWR, Unknown, N/A |
| paymentType | all | card (1), cash (2), other (all other warehouse payment codes) |
| granularity | month | month, quarter, year (used by overview/time) |

Unknown/repeated parameters and invalid values return 400 / `INVALID_FILTERS`.
SQL binds filter values and uses allow-listed grouping expressions. Month ranges use
`pickup_datetime >= start AND pickup_datetime < next_month`, with the stored local
pickup datetime unchanged. Locations refer to pickup, not dropoff.

## OLAP endpoints

The OLAP Explorer uses `GET /api/olap/{operation}` with these operations:

- `hierarchy`: drill down or roll up one level at a time through the time or pickup-location hierarchy.
- `rollup`: return detail rows, subtotals, and a grand total using `WITH ROLLUP`.
- `pivot`: compare a selected row dimension against a selected column dimension using conditional aggregation.

Common OLAP filters are `startMonth`, `endMonth`, `boroughs`, `payments`, and `dayType`.
Slice and dice are represented by restricting those filters: one restricted member is
reported as a slice, while multiple restrictions are reported as a dice selection.
The current location hierarchy is borough -> service zone -> taxi zone; the required
cross-dimension borough -> taxi zone -> day flow remains pending verification.

## Response

Shape only; `n` below denotes a numeric value, not a measured example:

```text
{
  report, filters,
  summary: {
    totalTrips: n, totalRevenue: n, averageFare: n,
    averageDistance: n, averageDuration: n
  },
  series: [{ key, label, trips: n, revenue: n, averageFare: n, share: n }],
  boroughs: [{ key, label, trips: n, revenue: n, averageFare: n, share: n }],
  meta: {
    source: "warehouse", status: "ready", currency: "USD", year: 2025,
    generatedAt: ISO_timestamp, queryMs: n,
    queryVersion: "dashboard-v3-covering" or "dashboard-v2",
    dateBasis: "pickup_datetime", revenueBasis: "SUM(total_amount)"
  }
}
```

Each request executes one grouped SELECT. Summary/series/borough aggregates all derive
from that selection; averages use summed numerators divided by trip counts. DECIMAL
strings from MySQL are converted to JSON numbers, with monetary accumulation in cents.
All-borough queries aggregate facts before joining location labels. The API detects
the optional invisible `idx_dashboard_cover_v1` index with a metadata lookup cached
for 30 seconds. Dashboard SELECTs alone enable invisible-index use with `SET_VAR`;
all-borough queries then read the covering index. Borough-specific queries retain
optimizer choice for selective joins. The data response itself is not cached.

Without the exact invisible index definition, the API falls back to `dashboard-v2`:
the existing `idx_pickup_ts` index for single all-borough months and optimizer choice
for wider ranges. The API never creates indexes or changes global/session defaults.
OLAP SELECTs do not receive the dashboard hint and do not run index detection.

- Overview/time: group by selected period and borough; series sorted chronologically.
- Locations: group by pickup location key, zone label and borough; sorted by trips.
- Payments: group by card/cash/other and borough; sorted by trips.
- Empty selections return zero summary measures and empty arrays.
- Revenue uses stored total charges, including negative corrections; fare uses base
  fare. No surcharge correction is inferred from validation discrepancies.
- Boroughs without trips are omitted; unknown/outside-NYC trips remain included.
- The location chart shows the top ten groups; the table/CSV contains all groups.

## Health and failures

`GET /api/health` executes a connection check and returns
`{status:"ready", source:"warehouse"}`. Database names, ports, and credentials are
not returned. It verifies connectivity,
not warehouse completeness. A report additionally requires the expected populated schema.

`npm run share` enables HTTP Basic authentication for the entire built website and
all API routes, including health checks. Unauthenticated requests return 401 before
any database query. Sharing credentials are generated per session and printed only
in the host's terminal. Normal local development does not require this sharing login.

Errors use `{error:{code,message}}`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_FILTERS | Invalid, unknown or repeated filter |
| 404 | REPORT_NOT_FOUND / NOT_FOUND | Unknown report or route |
| 501 | REPORT_WIP | No published optimization measurements |
| 503 | DATABASE_UNAVAILABLE | Connection, credentials, schema or database request failure |
| 504 | QUERY_TIMEOUT | SELECT exceeded its configured server execution budget |

Overview and Trip Trends have identical SQL for identical filters. Navigation can
reuse the displayed result while preserving its `generatedAt` and `queryMs`;
Apply/Reset/Retry always send a fresh API request.
The browser hides previous results while loading or on failure. Export is enabled
only for valid warehouse responses. Cancelling a request closes its MySQL connection;
no example data is substituted. Cancellation attempts `KILL QUERY` on that request's
own MySQL connection, then closes it. If cancellation is unavailable, the SELECT
execution budget still applies. The pool limits concurrent queries and queued requests.
Full-year baseline requests previously exceeded 180 seconds on this machine.
The dashboard's January comparison does not establish full-year performance.
OLAP requests use the same configured query budget and still execute against the
raw fact table.

## Optimization handoff

`app/server/reports.js` owns dashboard SQL and the aggregate result contract:
`group_key`, `group_label`, `borough`, `trips`, `revenue_cents`, `fare_cents`,
`distance_total`, `duration_total`. Preserve semantics and aliases when changing SQL.
Query timings here are request diagnostics, not controlled original-versus-optimized
measurements. Formal repeated OLAP optimization comparisons remain separate work.
See [dashboard optimization notes](dashboard-optimization.md) for the dashboard's
measured scope and initial results.

`npm run test:queries:live` executes 96 fixture comparisons on MySQL using CTEs,
without modifying tables. `npm run benchmark:reports` compares the frozen original
dashboard SQL in `app/scripts/lib/baseline-reports.js` with the running builder on
January warehouse data. Both commands require the local backend `.env` settings.
`--covering` compares the previous rewrite with the covering-index path; `--runs=3`
repeats measurements with alternating execution order.
