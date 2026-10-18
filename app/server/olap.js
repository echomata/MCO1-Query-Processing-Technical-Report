import mysql from 'mysql2';
import { BOROUGHS, PAYMENTS } from '../src/lib/config.js';
import { HIERARCHIES, OLAP_YEAR, PIVOT_DIMENSIONS, memberLabel } from '../src/lib/olap.js';

export const OLAP_OPERATIONS = ['hierarchy', 'rollup', 'pivot'];

const PAYMENT_CASE = "CASE WHEN f.payment_sk = 1 THEN 'card' WHEN f.payment_sk = 2 THEN 'cash' ELSE 'other' END";
const PAYMENT_SK = { card: 'f.payment_sk = 1', cash: 'f.payment_sk = 2', other: 'f.payment_sk NOT IN (1, 2)' };

// Every identifier that reaches SQL comes from this whitelist; user input is only ever bound as a value.
const EXPR = {
  year: 'd.year', quarter: 'd.quarter', month: 'd.month',
  day: "DATE_FORMAT(d.full_date, '%Y-%m-%d')",
  borough: 'l.borough', service_zone: 'l.service_zone', zone: 'l.zone',
  payment: PAYMENT_CASE,
  daytype: "CASE WHEN d.is_weekend = 1 THEN 'weekend' ELSE 'weekday' END",
};

function slicerConditions(filters) {
  const start = `${OLAP_YEAR}-${String(filters.startMonth).padStart(2, '0')}-01`;
  const end = filters.endMonth === 12 ? `${OLAP_YEAR + 1}-01-01` : `${OLAP_YEAR}-${String(filters.endMonth + 1).padStart(2, '0')}-01`;
  const conditions = ['f.pickup_datetime >= ?', 'f.pickup_datetime < ?'];
  const values = [start, end];
  if (filters.boroughs.length) {
    conditions.push(`l.borough IN (${filters.boroughs.map(() => '?').join(', ')})`);
    values.push(...filters.boroughs);
  }
  if (filters.payments.length) conditions.push(`(${filters.payments.map((p) => PAYMENT_SK[p]).join(' OR ')})`);
  if (filters.dayType !== 'all') conditions.push(`d.is_weekend = ${filters.dayType === 'weekend' ? 1 : 0}`);
  return { conditions, values };
}

function fromClause(...fragments) {
  const text = fragments.join(' ');
  const joins = [];
  if (/\bd\./.test(text)) joins.push('JOIN dim_date d ON d.date_sk = f.pickup_date_sk');
  if (/\bl\./.test(text)) joins.push('JOIN dim_location l ON l.location_sk = f.pu_location_sk');
  return ['FROM fact_trip f', ...joins].join('\n    ');
}

const hint = (timeoutMs) => `/*+ MAX_EXECUTION_TIME(${Math.max(1, Math.trunc(timeoutMs))}) */`;

// drill-down / roll-up: one hierarchy level per query, restricted to the members on the drill path.
function hierarchyQuery({ dimension, path }, filters, timeoutMs) {
  const levels = HIERARCHIES[dimension].levels;
  const expr = EXPR[levels[path.length].id];
  const slicer = slicerConditions(filters);
  const pathConditions = path.map((_, i) => `${EXPR[levels[i].id]} = ?`);
  const where = [...pathConditions, ...slicer.conditions].join('\n      AND ');
  const isTime = dimension === 'time';
  const windows = isTime
    ? `LAG(COUNT(*)) OVER (ORDER BY ${expr}) AS prev_trips,
      SUM(COUNT(*)) OVER (ORDER BY ${expr} ROWS UNBOUNDED PRECEDING) AS cumulative_trips`
    : `NULL AS prev_trips,
      SUM(COUNT(*)) OVER (ORDER BY COUNT(*) DESC, ${expr} ROWS UNBOUNDED PRECEDING) AS cumulative_trips`;
  const select = `${expr} AS member,
      COUNT(*) AS trips,
      SUM(f.total_amount) AS revenue,
      AVG(f.fare_amount) AS avg_fare,
      AVG(f.trip_distance) AS avg_distance,
      RANK() OVER (ORDER BY COUNT(*) DESC) AS trip_rank,
      ${windows}`;
  return {
    sql: `SELECT ${hint(timeoutMs)} ${select}
    ${fromClause(select, where)}
    WHERE ${where}
    GROUP BY ${expr}
    ORDER BY ${isTime ? expr : 'trips DESC'}`,
    values: [...path, ...slicer.values],
  };
}

// roll-up: GROUP BY ... WITH ROLLUP yields detail rows, every subtotal and the grand total in one pass.
function rollupQuery({ dimension, depth }, filters, timeoutMs) {
  const levels = HIERARCHIES[dimension].levels.slice(0, depth);
  const slicer = slicerConditions(filters);
  const keys = levels.map((level, i) => `${EXPR[level.id]} AS k${i}, GROUPING(${EXPR[level.id]}) AS g${i}`).join(',\n      ');
  const groupBy = levels.map((level) => EXPR[level.id]).join(', ');
  const where = slicer.conditions.join('\n      AND ');
  const select = `${keys},
      COUNT(*) AS trips,
      SUM(f.total_amount) AS revenue,
      AVG(f.fare_amount) AS avg_fare`;
  return {
    sql: `SELECT ${hint(timeoutMs)} ${select}
    ${fromClause(select, where)}
    WHERE ${where}
    GROUP BY ${groupBy} WITH ROLLUP`,
    values: slicer.values,
  };
}

export function pivotColumns(column, filters) {
  switch (column) {
    case 'quarter': {
      const quarters = new Set();
      for (let m = filters.startMonth; m <= filters.endMonth; m++) quarters.add(Math.ceil(m / 3));
      return [...quarters];
    }
    case 'month': return Array.from({ length: filters.endMonth - filters.startMonth + 1 }, (_, i) => filters.startMonth + i);
    case 'payment': return filters.payments.length ? filters.payments : PAYMENTS.map((p) => p.id);
    case 'daytype': return filters.dayType === 'all' ? ['weekday', 'weekend'] : [filters.dayType];
    default: return filters.boroughs.length ? filters.boroughs : BOROUGHS;
  }
}

// pivot: rotate one dimension into columns with conditional aggregation; ROLLUP adds the column-total row.
function pivotQuery({ rows, columns, measure }, filters, timeoutMs) {
  const rowExpr = EXPR[rows];
  const colExpr = EXPR[columns];
  const members = pivotColumns(columns, filters);
  const aggregate = {
    trips: (condition) => (condition ? `COUNT(CASE WHEN ${condition} THEN 1 END)` : 'COUNT(*)'),
    revenue: (condition) => `SUM(${condition ? `CASE WHEN ${condition} THEN f.total_amount END` : 'f.total_amount'})`,
    averageFare: (condition) => `AVG(${condition ? `CASE WHEN ${condition} THEN f.fare_amount END` : 'f.fare_amount'})`,
  }[measure];
  const slicer = slicerConditions(filters);
  const where = slicer.conditions.join('\n      AND ');
  const cells = members.map((_, i) => `${aggregate(`${colExpr} = ?`)} AS c${i}`).join(',\n      ');
  const select = `${rowExpr} AS row_key, GROUPING(${rowExpr}) AS row_g,
      ${cells},
      ${aggregate('')} AS row_total`;
  return {
    sql: `SELECT ${hint(timeoutMs)} ${select}
    ${fromClause(select, where, colExpr)}
    WHERE ${where}
    GROUP BY ${rowExpr} WITH ROLLUP`,
    values: [...members, ...slicer.values],
    members,
  };
}

export function buildOlapQuery(operation, request, timeoutMs = 180_000) {
  const { filters, options } = request;
  if (operation === 'hierarchy') return hierarchyQuery(options, filters, timeoutMs);
  if (operation === 'rollup') return rollupQuery(options, filters, timeoutMs);
  if (operation === 'pivot') return pivotQuery(options, filters, timeoutMs);
  throw new Error('Unknown OLAP operation');
}

const num = (value) => (value === null || value === undefined ? 0 : Number(value));
const displaySql = (query) => mysql.format(query.sql.replace(/\/\*\+.*?\*\/ /, ''), query.values);

function formatHierarchy({ dimension, path }, rows) {
  const levels = HIERARCHIES[dimension].levels;
  const level = levels[path.length];
  const totalTrips = rows.reduce((sum, row) => sum + num(row.trips), 0);
  const totalRevenue = rows.reduce((sum, row) => sum + num(row.revenue), 0);
  const fareSum = rows.reduce((sum, row) => sum + num(row.avg_fare) * num(row.trips), 0);
  return {
    dimension, level: level.id, levelLabel: level.label, path,
    canDrillDown: path.length < levels.length - 1,
    canRollUp: path.length > 0,
    breadcrumb: path.map((value, i) => ({ level: levels[i].id, levelLabel: levels[i].label, key: value, label: memberLabel(levels[i].id, value) })),
    summary: { trips: totalTrips, revenue: totalRevenue, averageFare: totalTrips ? fareSum / totalTrips : 0 },
    rows: rows.map((row) => {
      const trips = num(row.trips);
      const previous = row.prev_trips === null || row.prev_trips === undefined ? null : num(row.prev_trips);
      return {
        key: row.member, label: memberLabel(level.id, row.member),
        trips, revenue: num(row.revenue), averageFare: num(row.avg_fare), averageDistance: num(row.avg_distance),
        tripShare: totalTrips ? trips / totalTrips * 100 : 0,
        revenueShare: totalRevenue ? num(row.revenue) / totalRevenue * 100 : 0,
        rank: num(row.trip_rank),
        growth: previous ? (trips - previous) / previous * 100 : null,
        cumulativeShare: totalTrips ? num(row.cumulative_trips) / totalTrips * 100 : 0,
      };
    }),
  };
}

function formatRollup({ dimension, depth }, rows) {
  const levels = HIERARCHIES[dimension].levels.slice(0, depth);
  const parsed = rows.map((row) => {
    const keys = levels.map((_, i) => (Number(row[`g${i}`]) ? null : row[`k${i}`]));
    const level = keys.filter((key) => key !== null).length;
    return {
      keys, grouped: levels.map((_, i) => Number(row[`g${i}`])), level,
      trips: num(row.trips), revenue: num(row.revenue), averageFare: num(row.avg_fare),
    };
  });
  // detail rows precede their subtotal; the grand total is last.
  parsed.sort((a, b) => {
    for (let i = 0; i < levels.length; i++) {
      if (a.grouped[i] !== b.grouped[i]) return a.grouped[i] - b.grouped[i];
      if (a.grouped[i]) return 0;
      if (a.keys[i] !== b.keys[i]) return typeof a.keys[i] === 'number' ? a.keys[i] - b.keys[i] : String(a.keys[i]).localeCompare(String(b.keys[i]));
    }
    return 0;
  });
  const totals = new Map(parsed.map((row) => [JSON.stringify(row.keys.slice(0, row.level)), row.trips]));
  const grand = parsed.find((row) => row.level === 0)?.trips ?? 0;
  return {
    dimension, depth, levels: levels.map(({ id, label }) => ({ id, label })),
    rows: parsed.map((row) => {
      const parentTrips = row.level > 0 ? totals.get(JSON.stringify(row.keys.slice(0, row.level - 1))) : 0;
      return {
        level: row.level,
        kind: row.level === 0 ? 'grand' : row.level === levels.length ? 'detail' : 'subtotal',
        label: row.level === 0 ? 'Grand total' : memberLabel(levels[row.level - 1].id, row.keys[row.level - 1]),
        levelLabel: row.level === 0 ? 'All' : levels[row.level - 1].label,
        trips: row.trips, revenue: row.revenue, averageFare: row.averageFare,
        shareOfParent: parentTrips ? row.trips / parentTrips * 100 : null,
        shareOfTotal: grand ? row.trips / grand * 100 : 0,
      };
    }),
  };
}

function formatPivot({ rows: rowDimension, columns, measure }, query, rows) {
  const toValue = (raw) => (raw === null || raw === undefined ? (measure === 'averageFare' ? null : 0) : Number(raw));
  const cellsOf = (row) => query.members.map((_, i) => toValue(row[`c${i}`]));
  const body = rows.filter((row) => !Number(row.row_g)).map((row) => ({
    key: row.row_key, label: memberLabel(rowDimension, row.row_key), cells: cellsOf(row), total: toValue(row.row_total),
  }));
  const numericRows = ['quarter', 'month'].includes(rowDimension);
  body.sort((a, b) => (numericRows ? Number(a.key) - Number(b.key) : (b.total ?? 0) - (a.total ?? 0) || String(a.label).localeCompare(String(b.label))));
  const grandRow = rows.find((row) => Number(row.row_g));
  return {
    rows: rowDimension, columns, measure,
    rowLabel: PIVOT_DIMENSIONS[rowDimension], columnLabel: PIVOT_DIMENSIONS[columns],
    columnHeaders: query.members.map((member) => ({ key: member, label: memberLabel(columns, member) })),
    body,
    grand: grandRow ? { cells: cellsOf(grandRow), total: toValue(grandRow.row_total) } : null,
  };
}

export function formatOlap(operation, request, query, rows, queryMs) {
  const { options, filters } = request;
  const result = operation === 'hierarchy' ? formatHierarchy(options, rows)
    : operation === 'rollup' ? formatRollup(options, rows)
      : formatPivot(options, query, rows);
  return {
    operation, filters, ...result,
    meta: { source: 'warehouse', status: 'ready', year: OLAP_YEAR, generatedAt: new Date().toISOString(), queryMs: Math.round(queryMs), sql: displaySql(query) },
  };
}
