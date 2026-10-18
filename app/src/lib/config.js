export const REPORTS = [
  { id: 'overview', label: 'Overview', icon: 'overview', title: 'Overview', description: '' },
  { id: 'time', label: 'Trip trends', icon: 'chart', title: 'Trip Trends', description: 'Explore trip activity and revenue across the calendar.' },
  { id: 'locations', label: 'Location analysis', icon: 'pin', title: 'Location Analysis', description: 'Compare pickup activity across boroughs and taxi zones.' },
  { id: 'payments', label: 'Payment analysis', icon: 'wallet', title: 'Payment Analysis', description: 'Compare payment methods across your selected trips.' },
  { id: 'optimization', label: 'Optimization', icon: 'chart', title: 'Query performance.', description: 'Compare baseline and optimized query execution.', wip: true },
];

export const DEFAULT_FILTERS = {
  year: 2025, startMonth: 1, endMonth: 1,
  borough: 'all', paymentType: 'all', granularity: 'month',
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const BOROUGHS = ['Manhattan', 'Queens', 'Brooklyn', 'Bronx', 'Staten Island', 'EWR', 'Unknown', 'N/A'];
export const PAYMENTS = [
  { id: 'card', label: 'Credit card' },
  { id: 'cash', label: 'Cash' },
  { id: 'other', label: 'Other / unknown' },
];
