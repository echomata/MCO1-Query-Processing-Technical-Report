import { BOROUGHS, DEFAULT_FILTERS, PAYMENTS } from './config.js';

export function validateFilters(input = {}) {
  const filters = { ...DEFAULT_FILTERS, ...input };
  if (filters.year !== 2025) throw new Error('Reports currently support pickup dates in 2025 only.');
  if (![filters.startMonth, filters.endMonth].every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) throw new Error('Choose a valid starting and ending month.');
  if (filters.startMonth > filters.endMonth) throw new Error('The starting month must come before the ending month.');
  if (!['all', ...BOROUGHS].includes(filters.borough)) throw new Error('Choose a valid borough.');
  if (!['all', ...PAYMENTS.map((p) => p.id)].includes(filters.paymentType)) throw new Error('Choose a valid payment method.');
  if (!['month', 'quarter', 'year'].includes(filters.granularity)) throw new Error('Choose a valid time level.');
  return filters;
}

export function parseFilters(params) {
  const input = {};
  for (const [key, value] of params) {
    if (!Object.hasOwn(DEFAULT_FILTERS, key) || Object.hasOwn(input, key)) throw new Error(`Invalid or repeated filter: ${key}`);
    input[key] = ['year', 'startMonth', 'endMonth'].includes(key) ? Number(value) : value;
  }
  return validateFilters(input);
}