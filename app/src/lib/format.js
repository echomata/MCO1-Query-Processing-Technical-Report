export const number = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
export const decimal = (value, digits = 1) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
export const currency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
export function compact(value, money = false) {
  const amount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return money ? `$${amount}` : amount;
}