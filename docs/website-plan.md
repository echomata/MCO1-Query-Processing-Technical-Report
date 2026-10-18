# Website development status

Current scope: Svelte + Vite dashboard, Express API, live MySQL reports, OLAP
exploration, and functional-test evidence for the report.

## Completed

- [x] Dashboard layout, navigation, filters, cards, charts, tables, sorting, and CSV export.
- [x] Live API integration with no mock-data fallback.
- [x] Overview, trip-trend, pickup-location, and payment reports.
- [x] OLAP Explorer with hierarchy drill-down/roll-up, filter-based slice/dice, and pivot.
- [x] API and service tests for filters, live-result contracts, authentication, and OLAP query construction.
- [x] ETL and frontend functional-test cases recorded for the report.

The legacy fixture in `app/src/mock/` is retained for historical reference but is not
imported by the running application.

## Remaining

- [ ] Verify the exact required borough -> taxi zone -> day drill-down against the final specification.
- [ ] Add and measure the optimized SQL versions, preserving the current API semantics.
- [ ] Capture final OLAP evidence and complete the report and presentation materials.
