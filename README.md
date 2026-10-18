# STADVDB MCO1 — NYC Taxi Analytics

Meter is the Svelte + Vite dashboard and Express API for the team's NYC Taxi warehouse.
Overview, trends, pickup locations, and payment reports now query MySQL. The dashboard
never falls back to synthetic figures. Optimization comparison is marked **(WIP)** until
the team supplies its actual measurements.

## Run locally

Prerequisites: Node.js 22.12+ and a running, populated MySQL instance with the same
`nyc_yellow_taxi_2025` schema as `data/STADVDB-MCO1-Group3-Schema.sql`.
The repository does not contain the 48-million-row dataset; each teammate needs their
own imported data or access to the team's warehouse.

From the repository root, in PowerShell:

```powershell
cd app
npm ci
Copy-Item server/.env.example server/.env
notepad server/.env
```

Set your own host, port, database, user and password. The example defaults to port
**3307**. Your data directory and drive letter do not matter. Keep `.env` local;
it is gitignored. Do not put database credentials in `VITE_` variables.
If you already have `server/.env`, edit it instead of copying over it.

```powershell
npm run dev
```

This starts both the API (127.0.0.1:3001) and Vite (normally 127.0.0.1:5173).
Open the Local URL printed by Vite. Ctrl+C stops both processes.
Vite forwards `/api` to the backend; no browser-to-MySQL connection or CORS setup
is required. If you change `API_PORT`, restart both processes.

Check `http://127.0.0.1:3001/api/health` for the actual connected schema and port.
The badge becomes **LIVE DATABASE** only after a valid warehouse report arrives.
An unavailable database produces an error and retry button, with no example values.

## Verification and production

```powershell
npm test           # API contract, filters, weighted totals, errors and no-mock behavior
npm run build     # Build the Svelte frontend
npm run test:live # Explicit read-only checks against your configured populated DB
npm start         # Serve the build and API together at http://127.0.0.1:3001
```

`test:live` uses January / Staten Island as a small selection and compares all four
API reports with a direct SQL aggregate. It does not change warehouse data.
For separate development terminals use `npm run dev:api` and `npm run dev:client`.
Use `npm run dev` for routine local work; full-year baseline queries may take minutes.
The default SELECT budget is 180 seconds (maximum configurable 210 seconds).
On timeout, narrow the month range or use the team's equivalent optimized SQL.
The dashboard opens on **January 2025** to avoid an expensive automatic full-year
scan. Full-year baseline reports exceeded the 180-second budget on the current
machine during verification; they remain a performance limitation for the team to
address. Filters can be reapplied while a request is running to cancel that request.

## Data definitions

- Date scope is **pickup datetime in 2025**, using inclusive start / exclusive end
  month bounds. All 2025 source batches are not exactly the same as 2025 pickup dates:
  the imported snapshot contains 21 pickups outside 2025, so full-year trip totals
  can differ from the earlier unfiltered validation count of 48,720,347.
- Revenue is `SUM(total_amount)` as stored, including signed refund/correction rows.
  No fees are added or removed by the API. Component reconciliation remains an
  unresolved source/ETL caveat; the sampled $2.50 differences do not establish a
  universal correction formula.
- Average fare uses `fare_amount`; distance uses miles; duration uses `duration_min`.
  Averages are weighted by trip count. Shares use the same filtered trip population.
- Location means **pickup** zone/borough. Unknown and outside-NYC locations remain
  in all-borough totals and are shown under their stored borough names.
- Payment categories: `card` = code 1, `cash` = code 2, `other` = every other code
  (including unknown, flex fare, no charge, dispute and voided trips).
- Report source, retrieval timestamp, date basis and query time are included in API
  metadata. Query time is a diagnostic, not a controlled optimization benchmark.

## Team handoff

Baseline SQL is isolated in `app/server/reports.js` (`buildReportQuery`). All-borough
reports specify fact-first join order to avoid poor location-first estimates. Replace it
with equivalent optimized SQL while preserving filters and the aggregate aliases.
No indexes, schema changes, ETL runs or data updates are performed by this API.
Responses are not cached; benchmark work should record execution plans, repeat runs
under controlled conditions, and check original/optimized results are equivalent.

The existing four report views are live, but this does not complete all OLAP/spec
requirements: daily/zone drill-down, pivot, and the team's final business queries
still require their own implementation and verification. Optimization has a WIP page.

## Structure

```text
app/server/        Express routes, MySQL connection, baseline aggregate SQL, .env.example
app/scripts/       Combined dev launcher and opt-in live verification
app/src/           Svelte dashboard, shared filters, HTTP report service
app/src/mock/      Legacy fixture file; never imported by the running app
app/tests/         Automated API and service tests (test fixtures only)
docs/              API contract and project notes
sql/               Team SQL and validation queries
etl/               Team ETL and dimension seed scripts
data/              Warehouse schema; large datasets are not committed
```

See [the API contract](docs/api-contract.md) for endpoint and response details.