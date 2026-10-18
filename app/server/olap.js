import mysql from 'mysql2';
import { BOROUGHS, PAYMENTS } from '../src/lib/config.js';
import { HIERARCHIES, OLAP_YEAR, PIVOT_DIMENSIONS, memberLabel } from '../src/lib/olap.js';

export const OLAP_OPERATIONS = ['hierarchy', 'rollup', 'pivot'];

const PAYMENT_SK = { card: 'f.payment_sk = 1', cash: 'f.payment_sk = 2', other: 'f.payment_sk NOT IN (1, 2)' };

// Every identifier that reaches SQL comes from this whitelist; user input is only ever bound as a value.
// Time and payment parts come from the pre-aggregated derived table `a` (see baseTable), not from dim_date.
const EXPR = {
  year: 'YEAR(a.pickup_date)', quarter: 'QUARTER(a.pickup_date)', month: 'MONTH(a.pickup_date)',
  day: "DATE_FORMAT(a.pickup_date, '%Y-%m-%d')",
  borough: 'l.borough', service_zone: 'l.service_zone', zone: 'l.zone',
  payment: "CASE a.payment_bucket WHEN 1 THEN 'card' WHEN 2 THEN 'cash' ELSE 'other' END",
  daytype: "CASE WHEN DAYOFWEEK(a.pickup_date) IN (1, 7) THEN 'weekend' ELSE 'weekday' END",
};

// Every measure is a SUM over the derived table, so averages stay exact (sum of sums over sum of counts).
const MEASURE = {
  trips: 'SUM(a.trips)',
  revenue: 'SUM(a.revenue)',
  fare: 'SUM(a.fare_sum) / SUM(a.trips)',
  distance: 'SUM(a.distance_sum) / SUM(a.trips)',
  tripsIf: (c) => `SUM(CASE WHEN ${c} THEN a.trips END)`,
  revenueIf: (c) => `SUM(CASE WHEN ${c} THEN a.revenue END)`,
  fareIf: (c) => `SUM(CASE WHEN ${c} THEN a.fare_sum END) / SUM(CASE WHEN ${c} THEN a.trips END)`,
};

// One scan of fact_trip reduces millions of trips to day x pickup zone x payment groups (tens of thousands).
// Date range and payment filters run here, on the indexed fact columns, before any join.
function baseTable(filters) {
  const start = `${OLAP_YEAR}-${String(filters.startMonth).padStart(2, '0')}-01`;
  const end = filters.endMonth === 12 ? `${OLAP_YEAR + 1}-01-01` : `${OLAP_YEAR}-${String(filters.endMonth + 1).padStart(2, '0')}-01`;
  const conditions = ['f.pickup_datetime >= ?', 'f.pickup_datetime < ?'];
  if (filters.payments.length > 0) conditions.push(`(${filters.payments.map((payment) => PAYMENT_SK[payment]).join(' OR ')})`);
  return {
    values: [start, end],
    sql: `(SELECT DATE(f.pickup_datetime) AS pickup_date, f.pu_location_sk,
        CASE WHEN f.payment_sk = 1 THEN 1 WHEN f.payment_sk = 2 THEN 2 ELSE 3 END AS payment_bucket,
        COUNT(*) AS trips, SUM(f.total_amount) AS revenue,
        SUM(f.fare_amount) AS fare_sum, SUM(f.trip_distance) AS distance_sum
      FROM fact_trip f
      WHERE ${conditions.join('\n        AND ')}
      GROUP BY DATE(f.pickup_datetime), f.pu_location_sk, payment_bucket) a`,
  };
}

// Filters that need a dimension attribute run on the small aggregated set.
function outerConditions(filters) {
  const conditions = [];
  const values = [];
  if (filters.boroughs.length > 0) {
    conditions.push(`l.borough IN (${filters.boroughs.map(() => '?').join(', ')})`);
    values.push(...filters.boroughs);
  }
  if (filters.dayType !== 'all') conditions.push(`DAYOFWEEK(a.pickup_date) ${filters.dayType === 'weekend' ? 'IN' : 'NOT IN'} (1, 7)`);
  return { conditions, values };
}

// dim_location is only joined (against the small aggregate) when a location attribute is used.
function fromClause(base, text) {
  return [`FROM ${base.sql}`, ...(/\bl\./.test(text) ? ['JOIN dim_location l ON l.location_sk = a.pu_location_sk'] : [])].join('\n    ');
}

function statement({ select, groupBy, orderBy }, filters, timeoutMs, { conditions = [], values = [] } = {}) {
  const base = baseTable(filters);
  const outer = outerConditions(filters);
  const where = [...conditions, ...outer.conditions];
  return {
    sql: `SELECT ${hint(timeoutMs)} ${select}
    ${fromClause(base, [select, groupBy, ...where].join(' '))}${where.length ? `\n    WHERE ${where.join('\n      AND ')}` : ''}
    GROUP BY ${groupBy}${orderBy ? `\n    ORDER BY ${orderBy}` : ''}`,
    values: [...base.values, ...values, ...outer.values],
  };
}

// Drilling into a time member narrows the indexed date range itself, so deeper levels scan fewer fact rows.
function narrowByTimePath(filters, path) {
  const [year, quarter, month] = path;
  let low = filters.startMonth;
  let high = filters.endMonth;
  if (quarter) { low = Math.max(low, quarter * 3 - 2); high = Math.min(high, quarter * 3); }
  if (month) { low = Math.max(low, month); high = Math.min(high, month); }
  return { filters: { ...filters, startMonth: low, endMonth: high }, empty: year !== undefined && year !== OLAP_YEAR };
}

const hint = (timeoutMs) => `/*+ MAX_EXECUTION_TIME(${Math.max(1, Math.trunc(timeoutMs))}) */`;

// drill-down / roll-up: one hierarchy level per query, restricted to the members on the drill path.
function hierarchyQuery({ dimension, path }, filters, timeoutMs) {
  const levels = HIERARCHIES[dimension].levels;
  const expr = EXPR[levels[path.length].id];
  const isTime = dimension === 'time';
  let effective = filters;
  const conditions = [];
  const values = [];
  if (isTime) {
    const narrowed = narrowByTimePath(filters, path);
    effective = narrowed.filters;
    if (narrowed.empty) conditions.push('1 = 0');
  } else {
    path.forEach((value, i) => { conditions.push(`${EXPR[levels[i].id]} = ?`); values.push(value); });
  }
  const windows = isTime
    ? `LAG(${MEASURE.trips}) OVER (ORDER BY ${expr}) AS prev_trips,
      SUM(${MEASURE.trips}) OVER (ORDER BY ${expr} ROWS UNBOUNDED PRECEDING) AS cumulative_trips`
    : `NULL AS prev_trips,
      SUM(${MEASURE.trips}) OVER (ORDER BY ${MEASURE.trips} DESC, ${expr} ROWS UNBOUNDED PRECEDING) AS cumulative_trips`;
  const select = `${expr} AS member,
      ${MEASURE.trips} AS trips,
      ${MEASURE.revenue} AS revenue,
      ${MEASURE.fare} AS avg_fare,
      ${MEASURE.distance} AS avg_distance,
      RANK() OVER (ORDER BY ${MEASURE.trips} DESC) AS trip_rank,
      ${windows}`;
  return statement({ select, groupBy: expr, orderBy: isTime ? expr : 'trips DESC' }, effective, timeoutMs, { conditions, values });
}

// roll-up: GROUP BY ... WITH ROLLUP yields detail rows, every subtotal and the grand total in one pass.
function rollupQuery({ dimension, depth }, filters, timeoutMs) {
  const levels = HIERARCHIES[dimension].levels.slice(0, depth);
  const keys = levels.map((level, i) => `${EXPR[level.id]} AS k${i}, GROUPING(${EXPR[level.id]}) AS g${i}`).join(',\n      ');
  const groupBy = levels.map((level) => EXPR[level.id]).join(', ');
  const select = `${keys},
      ${MEASURE.trips} AS trips,
      ${MEASURE.revenue} AS revenue,
      ${MEASURE.fare} AS avg_fare`;
  return statement({ select, groupBy: `${groupBy} WITH ROLLUP` }, filters, timeoutMs);
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
  const [total, conditional] = {
    trips: [MEASURE.trips, MEASURE.tripsIf],
    revenue: [MEASURE.revenue, MEASURE.revenueIf],
    averageFare: [MEASURE.fare, MEASURE.fareIf],
  }[measure];
  const cells = members.map((_, i) => `${conditional(`${colExpr} = ?`)} AS c${i}`).join(',\n      ');
  const select = `${rowExpr} AS row_key, GROUPING(${rowExpr}) AS row_g,
      ${cells},
      ${total} AS row_total`;
  const query = statement({ select, groupBy: `${rowExpr} WITH ROLLUP` }, filters, timeoutMs);
  // Member placeholders sit in the SELECT list, ahead of the derived table in bind order; average cells use each one twice.
  const bound = members.flatMap((member) => (measure === 'averageFare' ? [member, member] : [member]));
  return { ...query, values: [...bound, ...query.values], members };
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
