import { REPORTS } from '../lib/config.js';
import { validateFilters } from '../lib/reportFilters.js';

export { validateFilters } from '../lib/reportFilters.js';

// Only warehouse responses can reach the dashboard. No synthetic fallback.
export async function getReport(report, input, { signal, fetchImpl = globalThis.fetch } = {}) {
  const definition = REPORTS.find((item) => item.id === report);
  if (!definition) throw new Error('That report is not available.');
  const filters = validateFilters(input);
  signal?.throwIfAborted();
  if (definition.wip) return { report, filters, meta: { status: 'wip', source: null } };
  const timeout = AbortSignal.timeout(240_000);
  let response;
  try {
    response = await fetchImpl(`/api/reports/${report}?${new URLSearchParams(filters)}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json' },
    });
  } catch {
    if (signal?.aborted) throw signal.reason;
    if (timeout.aborted) throw new Error('The report timed out. Try a smaller month range.');
    throw new Error('Cannot reach the API. Start the app with npm run dev and check the backend terminal.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The API did not return JSON. Check that the backend is running.'); }
  if (!response.ok) throw new Error(data.error?.message || 'Unable to load the warehouse report.');
  if (data.report !== report || data.meta?.source !== 'warehouse' || data.meta?.status !== 'ready') throw new Error('Live warehouse results are not available for this report.');
  const summaryKeys = ['totalTrips', 'totalRevenue', 'averageFare', 'averageDistance', 'averageDuration'];
  const validRow = (row) => typeof row.label === 'string' && ['trips', 'revenue', 'averageFare', 'share'].every((key) => Number.isFinite(row[key]));
  if (!summaryKeys.every((key) => Number.isFinite(data.summary?.[key])) || !Array.isArray(data.series) || !Array.isArray(data.boroughs) || !data.series.every(validRow) || !data.boroughs.every(validRow)) throw new Error('The API returned an incomplete warehouse report.');
  return data;
}