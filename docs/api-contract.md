# Dashboard API contract

Implemented endpoint: `GET /api/reports/{report}`. The frontend uses relative `/api`
URLs. Vite proxies them during development; `npm start` serves the build and API
on the same local origin. All API responses have `Cache-Control: no-store`.

## Reports and filters

Live report IDs: `overview`, `time`, `locations`, `payments`.
`optimization` returns HTTP 501 / `REPORT_WIP`; its UI displays (WIP) with no figures.
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
    generatedAt: ISO_timestamp, queryMs: n, queryVersion: "baseline",
    dateBasis: "pickup_datetime", revenueBasis: "SUM(total_amount)"
  }
}
```

Each request executes one grouped SELECT. Summary/series/borough aggregates all derive
from that selection; averages use summed numerators divided by trip counts. DECIMAL
strings from MySQL are converted to JSON numbers, with monetary accumulation in cents.

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
`{status:"ready", source:"warehouse", database, port}`. It verifies connectivity,
not warehouse completeness. A report additionally requires the expected populated schema.

Errors use `{error:{code,message}}`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_FILTERS | Invalid, unknown or repeated filter |
| 404 | REPORT_NOT_FOUND / NOT_FOUND | Unknown report or route |
| 501 | REPORT_WIP | No published optimization measurements |
| 503 | DATABASE_UNAVAILABLE | Connection, credentials, schema or database request failure |
| 504 | QUERY_TIMEOUT | SELECT exceeded its configured server execution budget |

The browser hides previous results while loading or on failure. Export is enabled
only for valid warehouse responses. Cancelling a request closes its MySQL connection;
no example data is substituted. Cancellation attempts `KILL QUERY` on that request's
own MySQL connection, then closes it. If cancellation is unavailable, the SELECT
execution budget still applies. The pool limits concurrent queries and queued requests.
Full-year baseline requests exceeded 180 seconds on the current machine; use narrower
selections until the team's equivalent optimized queries are integrated.

## Optimization handoff

`app/server/reports.js` owns baseline SQL and the aggregate result contract:
`group_key`, `group_label`, `borough`, `trips`, `revenue_cents`, `fare_cents`,
`distance_total`, `duration_total`. Preserve semantics and aliases when changing SQL.
Query timings here are request diagnostics, not controlled original-versus-optimized
measurements. Daily drill-down, pivot, final business-query mapping and measured
optimization comparisons remain separate pending work.