import { mockTrips } from '../mock/trips.js';
import { BOROUGHS, DEFAULT_FILTERS, MONTHS, PAYMENTS, REPORTS } from '../lib/config.js';

export function validateFilters(input) {
  const filters = { ...DEFAULT_FILTERS, ...input };
  if (filters.year !== 2025) throw new Error('Sample data is available for 2025 only.');
  if (![filters.startMonth, filters.endMonth].every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) throw new Error('Choose a valid starting and ending month.');
  if (filters.startMonth > filters.endMonth) throw new Error('The starting month must come before the ending month.');
  if (!['all', ...BOROUGHS].includes(filters.borough)) throw new Error('Choose a valid borough.');
  if (!['all', ...PAYMENTS.map((p) => p.id)].includes(filters.paymentType)) throw new Error('Choose a valid payment method.');
  if (!['month', 'quarter', 'year'].includes(filters.granularity)) throw new Error('Choose a valid time level.');
  return filters;
}

function totals(records) {
  return records.reduce((total, row) => ({
    trips: total.trips + row.trips,
    revenueCents: total.revenueCents + row.revenueCents,
    fareCents: total.fareCents + row.fareCents,
    distanceTotal: total.distanceTotal + row.distanceTotal,
    durationTotal: total.durationTotal + row.durationTotal,
  }), { trips: 0, revenueCents: 0, fareCents: 0, distanceTotal: 0, durationTotal: 0 });
}

function group(records, keyFor, labelFor) {
  const groups = new Map();
  for (const row of records) {
    const key = keyFor(row);
    if (!groups.has(key)) groups.set(key, { label: labelFor(row), records: [] });
    groups.get(key).records.push(row);
  }
  const allTrips = totals(records).trips;
  return [...groups].map(([key, entry]) => {
    const sum = totals(entry.records);
    return {
      key, label: entry.label, trips: sum.trips,
      revenue: sum.revenueCents / 100,
      averageFare: sum.trips ? sum.fareCents / 100 / sum.trips : 0,
      share: allTrips ? sum.trips / allTrips * 100 : 0,
    };
  });
}

export function buildMockReport(report = 'overview', input = DEFAULT_FILTERS) {
  if (!REPORTS.some((item) => item.id === report)) throw new Error('That report is not available.');
  const filters = validateFilters(input);
  const records = mockTrips.filter((row) =>
    row.year === filters.year && row.month >= filters.startMonth && row.month <= filters.endMonth &&
    (filters.borough === 'all' || row.borough === filters.borough) &&
    (filters.paymentType === 'all' || row.paymentType === filters.paymentType),
  );
  const sum = totals(records);
  const timeKey = (row) => filters.granularity === 'year' ? row.year : filters.granularity === 'quarter' ? Math.ceil(row.month / 3) : row.month;
  const timeLabel = (row) => filters.granularity === 'year' ? String(row.year) : filters.granularity === 'quarter' ? `Q${Math.ceil(row.month / 3)}` : MONTHS[row.month - 1].slice(0, 3);
  const time = group(records, timeKey, timeLabel).sort((a, b) => a.key - b.key);
  const boroughs = group(records, (row) => row.borough, (row) => row.borough).sort((a, b) => b.trips - a.trips);
  const locations = group(records, (row) => row.zone, (row) => row.zone).sort((a, b) => b.trips - a.trips);
  const payments = group(records, (row) => row.paymentType, (row) => PAYMENTS.find((p) => p.id === row.paymentType).label).sort((a, b) => b.trips - a.trips);
  return {
    report, filters,
    summary: {
      totalTrips: sum.trips, totalRevenue: sum.revenueCents / 100,
      averageFare: sum.trips ? sum.fareCents / 100 / sum.trips : 0,
      averageDistance: sum.trips ? sum.distanceTotal / sum.trips : 0,
      averageDuration: sum.trips ? sum.durationTotal / sum.trips : 0,
    },
    series: report === 'locations' ? locations : report === 'payments' ? payments : time,
    boroughs,
    meta: { source: 'mock', currency: 'USD', year: filters.year },
  };
}

export async function getReport(report, filters, { signal } = {}) {
  await new Promise((resolve, reject) => {
    const fail = () => { clearTimeout(timer); reject(new DOMException('Request cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', fail); resolve(); }, 250);
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });
  return buildMockReport(report, filters);
}