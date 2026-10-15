# Website development chunks

Current scope: Svelte + Vite website/dashboard and frontend functional testing, with supporting evidence for the report. The final backend and warehouse design belong to the team's other workstreams.

## Completed initial foundation

- [x] Chunk 0: inspect repository and document local run instructions.
- [x] Chunk 1: create Svelte + Vite application and npm scripts.
- [x] Chunk 2: responsive dashboard layout, navigation, filter panel, cards, charts, and tables.
- [x] Chunk 3: deterministic mock records and a service that can later be replaced with API requests.

The foundation also includes provisional time, location, and payment views, functional filters, time roll-up, table sorting, and CSV export. These are sample-data demonstrations, not validated real OLAP report results.

## Remaining

- [ ] Chunk 4: confirm the first business report and its SQL-backed result format with the teammate.
- [ ] Chunk 5: finalize hierarchy controls, contextual drill-down to zones/days, and slice/dice behavior against the final schema.
- [ ] Chunk 6: finalize additional reports and implement pivot controls/cross-tab.
- [ ] Chunk 7: review visual design with the user and polish accessibility, empty/error scenarios, and interactions.
- [ ] Chunk 8: record frontend functional cases and extend checks to UI behavior.
- [ ] Chunk 9: integrate the real API and compare displayed results with reference query outputs.
- [ ] Chunk 10: final screenshots, setup instructions, submission packaging, report contributions, and presentation walkthrough.