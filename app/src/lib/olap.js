import { BOROUGHS, MONTHS, PAYMENTS } from './config.js';

export const OLAP_YEAR = 2025;

// each hierarchy is ordered from the coarsest level to the finest.
export const HIERARCHIES = {
  time: { label: 'Time', levels: [
    { id: 'year', label: 'Year' }, { id: 'quarter', label: 'Quarter' },
    { id: 'month', label: 'Month' }, { id: 'day', label: 'Day' },
  ] },
  location: { label: 'Pickup location', levels: [
    { id: 'borough', label: 'Borough' }, { id: 'service_zone', label: 'Service zone' }, { id: 'zone', label: 'Taxi zone' },
  ] },
};

export const MEASURES = [
  { id: 'trips', label: 'Trips' }, { id: 'revenue', label: 'Revenue' }, { id: 'averageFare', label: 'Average fare' },
];

export const DAY_TYPES = [{ id: 'weekday', label: 'Weekday' }, { id: 'weekend', label: 'Weekend' }];

export const PIVOT_DIMENSIONS = {
  borough: 'Pickup borough', service_zone: 'Service zone', quarter: 'Quarter',
  month: 'Month', payment: 'Payment method', daytype: 'Day type',
};
export const PIVOT_ROWS = ['borough', 'service_zone', 'quarter', 'month', 'payment', 'daytype'];
export const PIVOT_COLUMNS = ['borough', 'quarter', 'month', 'payment', 'daytype'];

export const OLAP_DEFAULTS = { startMonth: 1, endMonth: 3, boroughs: [], payments: [], dayType: 'all' };

export function memberLabel(levelId, value) {
  if (value === null || value === undefined) return 'All';
  switch (levelId) {
    case 'quarter': return `Q${value}`;
    case 'month': return MONTHS[Number(value) - 1] ?? String(value);
    case 'payment': return PAYMENTS.find((p) => p.id === value)?.label ?? String(value);
    case 'daytype': return DAY_TYPES.find((d) => d.id === value)?.label ?? String(value);
    default: return String(value);
  }
}

export function validateOlapFilters(input = {}) {
  const filters = { ...OLAP_DEFAULTS, ...input };
  if (![filters.startMonth, filters.endMonth].every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) throw new Error('Choose a valid starting and ending month.');
  if (filters.startMonth > filters.endMonth) throw new Error('The starting month must come before the ending month.');
  if (!Array.isArray(filters.boroughs) || !filters.boroughs.every((b) => BOROUGHS.includes(b))) throw new Error('Choose valid boroughs.');
  if (!Array.isArray(filters.payments) || !filters.payments.every((p) => PAYMENTS.some((x) => x.id === p))) throw new Error('Choose valid payment methods.');
  if (!['all', ...DAY_TYPES.map((d) => d.id)].includes(filters.dayType)) throw new Error('Choose a valid day type.');
  return { ...filters, boroughs: [...new Set(filters.boroughs)], payments: [...new Set(filters.payments)] };
}

export function serializeOlapFilters(filters) {
  const params = new URLSearchParams({ startMonth: filters.startMonth, endMonth: filters.endMonth, dayType: filters.dayType });
  if (filters.boroughs.length) params.set('boroughs', filters.boroughs.join(','));
  if (filters.payments.length) params.set('payments', filters.payments.join(','));
  return params;
}

export function parseOlapFilters(params) {
  const list = (key) => (params.get(key) ?? '').split(',').filter(Boolean);
  const number = (key, fallback) => (params.has(key) ? Number(params.get(key)) : fallback);
  return validateOlapFilters({
    startMonth: number('startMonth', OLAP_DEFAULTS.startMonth),
    endMonth: number('endMonth', OLAP_DEFAULTS.endMonth),
    boroughs: list('boroughs'), payments: list('payments'),
    dayType: params.get('dayType') ?? OLAP_DEFAULTS.dayType,
  });
}

// a slice fixes exactly one dimension to one member; any other restriction is a dice.
export function describeSelection(filters) {
  const restricted = [];
  const months = filters.endMonth - filters.startMonth + 1;
  if (months < 12) restricted.push({ name: 'Time', members: months });
  if (filters.boroughs.length && filters.boroughs.length < BOROUGHS.length) restricted.push({ name: 'Borough', members: filters.boroughs.length });
  if (filters.payments.length && filters.payments.length < PAYMENTS.length) restricted.push({ name: 'Payment', members: filters.payments.length });
  if (filters.dayType !== 'all') restricted.push({ name: 'Day type', members: 1 });
  if (!restricted.length) return { kind: 'cube', label: 'Full cube', detail: 'No dimension is restricted.' };
  if (restricted.length === 1 && restricted[0].members === 1) return { kind: 'slice', label: 'Slice', detail: `${restricted[0].name} fixed to one member.` };
  return { kind: 'dice', label: 'Dice', detail: `${restricted.map((r) => `${r.name} (${r.members})`).join(' × ')} sub-cube.` };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validMember(levelId, value) {
  if (['year', 'quarter', 'month'].includes(levelId)) return Number.isInteger(value) && value > 0 && value < 10000;
  if (levelId === 'day') return typeof value === 'string' && DAY.test(value);
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

export function parseOlapRequest(operation, params) {
  const filters = parseOlapFilters(params);
  const dimension = params.get('dimension') ?? 'time';
  if (operation === 'pivot') {
    const rows = params.get('rows') ?? 'borough';
    const columns = params.get('columns') ?? 'quarter';
    const measure = params.get('measure') ?? 'trips';
    if (!PIVOT_ROWS.includes(rows)) throw new Error('Choose a valid row dimension.');
    if (!PIVOT_COLUMNS.includes(columns)) throw new Error('Choose a valid column dimension.');
    if (rows === columns) throw new Error('Rows and columns must use different dimensions.');
    if (!MEASURES.some((m) => m.id === measure)) throw new Error('Choose a valid measure.');
    return { filters, options: { rows, columns, measure } };
  }
  const hierarchy = HIERARCHIES[dimension];
  if (!hierarchy) throw new Error('Choose a valid dimension.');
  if (operation === 'rollup') {
    const depth = params.has('depth') ? Number(params.get('depth')) : Math.min(3, hierarchy.levels.length);
    if (!Number.isInteger(depth) || depth < 2 || depth > hierarchy.levels.length) throw new Error('Choose a valid hierarchy depth.');
    return { filters, options: { dimension, depth } };
  }
  if (operation === 'hierarchy') {
    let path = [];
    try { path = JSON.parse(params.get('path') ?? '[]'); } catch { throw new Error('Invalid drill path.'); }
    if (!Array.isArray(path) || path.length >= hierarchy.levels.length || !path.every((value, i) => validMember(hierarchy.levels[i].id, value))) throw new Error('Invalid drill path.');
    return { filters, options: { dimension, path } };
  }
  throw new Error('Unknown OLAP operation.');
}
