import { serializeOlapFilters, validateOlapFilters } from '../lib/olap.js';

export async function getOlap(operation, input, options = {}, { signal, fetchImpl = globalThis.fetch } = {}) {
  const filters = validateOlapFilters(input);
  signal?.throwIfAborted();
  const params = serializeOlapFilters(filters);
  for (const [key, value] of Object.entries(options)) params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  const timeout = AbortSignal.timeout(240_000);
  let response;
  try {
    response = await fetchImpl(`/api/olap/${operation}?${params}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json' },
    });
  } catch {
    if (signal?.aborted) throw signal.reason;
    if (timeout.aborted) throw new Error('The query timed out. Try a smaller month range.');
    throw new Error('Cannot reach the API. Start the app with npm run dev and check the backend terminal.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The API did not return JSON. Check that the backend is running.'); }
  if (!response.ok) throw new Error(data.error?.message || 'Unable to load the OLAP result.');
  if (data.operation !== operation || data.meta?.source !== 'warehouse') throw new Error('Live warehouse results are not available for this query.');
  return data;
}
