# STADVDB MCO1 — NYC Taxi Analytics

**Meter** is the Svelte + Vite dashboard for the team's Query Processing in a Data Warehouse project.

The current website uses synthetic sample data. No MySQL server or dataset download is needed to run this preview. Values displayed in the preview are not actual NYC TLC results.

## Run the website

Install Node.js 22.12 or newer. In a terminal opened at the repository root:

```powershell
cd app
npm install
npm run dev
```

Open the Local URL printed in the terminal, normally `http://127.0.0.1:5173`.
Leave the terminal running while using the dashboard. Press Ctrl+C to stop it.

```powershell
npm test           # Validate the mock report calculations and filters
npm run build      # Create the production build in app/dist
npm run preview    # Preview that build locally
```

Commit `package-lock.json` so teammates install the same dependencies. They can use `npm ci` after cloning.

## What works now

- Overview, trip trends, pickup location, and payment report views.
- Month range, pickup borough, payment method, and time level filters.
- Monthly, quarterly, and yearly aggregation of sample records.
- Summary cards, charts, sortable result tables, and CSV export.
- Responsive navigation, loading states, validation, and retry handling.

The website is currently a frontend prototype. Real SQL reports, zone/day drill-down, pivot, and backend integration still need to be implemented or confirmed with the team.

## Repository structure

```text
app/
  src/
    components/        Reusable Svelte interface components
    lib/               Shared report configuration and formatting
    mock/              Synthetic report fixtures
    services/          Data access boundary for the future API
    App.svelte         Dashboard state and page layout
    styles.css         Responsive visual styling
  tests/               Mock report calculation tests
docs/                  API proposal, website plan, and development notes
sql/                   Team's SQL work
etl/                   Team's ETL work
data/                  Local data (raw datasets are ignored)
tests/                 Team's integration/functional/performance tests
```

See [the website plan](docs/website-plan.md), [the API contract proposal](docs/api-contract.md), and [development notes](docs/development-notes.md).

## Backend handoff

Components call `app/src/services/reportService.js`. Replace `getReport()` with the agreed HTTP call when the backend is ready. Keep MySQL credentials on the backend; Vite variables are public browser configuration.
