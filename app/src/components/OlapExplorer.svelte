<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { BOROUGHS, MONTHS, PAYMENTS } from '../lib/config.js';
  import { currency, decimal, number } from '../lib/format.js';
  import { DAY_TYPES, HIERARCHIES, MEASURES, OLAP_DEFAULTS, PIVOT_COLUMNS, PIVOT_DIMENSIONS, PIVOT_ROWS, describeSelection, validateOlapFilters } from '../lib/olap.js';
  import { getOlap } from '../services/olapService.js';

  const VIEWS = [
    { id: 'hierarchy', label: 'Drill-down / roll-up', hint: 'Move one level at a time along a dimension hierarchy.' },
    { id: 'rollup', label: 'Subtotals', hint: 'Detail rows with every subtotal and the grand total (GROUP BY … WITH ROLLUP).' },
    { id: 'pivot', label: 'Pivot', hint: 'Rotate one dimension into columns to compare two dimensions at once.' },
  ];

  let view = $state('hierarchy');
  let filters = $state({ ...OLAP_DEFAULTS });
  let draft = $state({ ...OLAP_DEFAULTS });
  let filterError = $state('');
  let dimension = $state('time');
  let path = $state([]);
  let depth = $state(3);
  let pivot = $state({ rows: 'borough', columns: 'quarter', measure: 'trips' });
  let result = $state(null);
  let loading = $state(true);
  let error = $state('');
  let controller;

  let activeView = $derived(VIEWS.find((item) => item.id === view));
  let selection = $derived(describeSelection(filters));
  let levels = $derived(HIERARCHIES[dimension].levels);
  let maxDepth = $derived(levels.length);

  // Results are keyed by everything that shapes them, so rolling up or revisiting a tab needs no request.
  const CACHE_MS = 5 * 60_000;
  const cache = new Map();

  async function load(force = false) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    error = '';
    const options = view === 'hierarchy' ? { dimension, path } : view === 'rollup' ? { dimension, depth } : { ...pivot };
    const key = JSON.stringify([view, $state.snapshot(filters), options]);
    const hit = cache.get(key);
    if (force !== true && hit && Date.now() - hit.at < CACHE_MS) { result = hit.data; loading = false; return; }
    loading = true; result = null;
    try {
      const data = await getOlap(view, filters, options, { signal: current.signal });
      if (!current.signal.aborted) {
        result = data;
        if (cache.size >= 40) cache.delete(cache.keys().next().value);
        cache.set(key, { at: Date.now(), data });
      }
    } catch (problem) {
      if (!current.signal.aborted && problem.name !== 'AbortError') error = problem.message || 'Unable to load this query.';
    } finally { if (!current.signal.aborted) loading = false; }
  }

  function selectView(id) { view = id; load(); }
  function chooseDimension(next) { dimension = next; path = []; depth = Math.min(depth, HIERARCHIES[next].levels.length); if (depth < 2) depth = 2; load(); }
  function drillDown(row) { if (!result?.canDrillDown) return; path = [...path, row.key]; load(); }
  function rollUp(toDepth = path.length - 1) { path = path.slice(0, Math.max(0, toDepth)); load(); }
  function applyFilters(event) {
    event.preventDefault();
    try { filters = validateOlapFilters({ ...draft, startMonth: Number(draft.startMonth), endMonth: Number(draft.endMonth) }); filterError = ''; load(); }
    catch (problem) { filterError = problem.message; }
  }
  function resetFilters() { draft = { ...OLAP_DEFAULTS }; filters = { ...OLAP_DEFAULTS }; filterError = ''; load(); }
  function toggle(list, value) { draft[list] = draft[list].includes(value) ? draft[list].filter((item) => item !== value) : [...draft[list], value]; }
  function measureText(measure, value) {
    if (value === null || value === undefined) return '–';
    return measure === 'trips' ? number(value) : currency(value);
  }
  let pivotMax = $derived(result?.operation === 'pivot' ? Math.max(0, ...result.body.flatMap((row) => row.cells.map((cell) => cell ?? 0))) : 0);
  const shade = (value) => (pivotMax && value ? `background: rgba(97, 122, 104, ${(0.08 + 0.42 * value / pivotMax).toFixed(2)})` : '');

  onMount(() => { load(); return () => controller?.abort(); });
</script>

<form class="filter-panel olap-filters" onsubmit={applyFilters}>
  <div class="filter-heading">
    <Icon name="filter" size={18} /><h2>Slice &amp; dice</h2>
    <span class={`olap-badge ${selection.kind}`} title={selection.detail}>{selection.label}</span>
  </div>
  <div class="olap-filter-grid">
    <label>From month<select bind:value={draft.startMonth}>{#each MONTHS as month, index}<option value={index + 1}>{month}</option>{/each}</select></label>
    <label>To month<select bind:value={draft.endMonth}>{#each MONTHS as month, index}<option value={index + 1}>{month}</option>{/each}</select></label>
    <label>Day type<select bind:value={draft.dayType}><option value="all">All days</option>{#each DAY_TYPES as type}<option value={type.id}>{type.label}</option>{/each}</select></label>
    <fieldset><legend>Pickup borough</legend><div class="check-row">{#each BOROUGHS as borough}<label class="check"><input type="checkbox" checked={draft.boroughs.includes(borough)} onchange={() => toggle('boroughs', borough)} />{borough}</label>{/each}</div></fieldset>
    <fieldset><legend>Payment method</legend><div class="check-row">{#each PAYMENTS as payment}<label class="check"><input type="checkbox" checked={draft.payments.includes(payment.id)} onchange={() => toggle('payments', payment.id)} />{payment.label}</label>{/each}</div></fieldset>
    <div class="filter-actions"><button class="button button-primary" type="submit">Apply<Icon name="arrow" size={16} /></button><button class="button-icon reset-button" type="button" aria-label="Reset all filters" title="Reset all filters" onclick={resetFilters}><Icon name="reset" size={17} /></button></div>
  </div>
  <p class="olap-hint">No box ticked means every member. One dimension fixed to one member is a <strong>slice</strong>; any other restriction is a <strong>dice</strong>. {selection.detail}</p>
  {#if filterError}<p class="filter-error" role="alert">{filterError}</p>{/if}
</form>

<div class="olap-tabs" role="tablist" aria-label="OLAP operation">
  {#each VIEWS as item}<button role="tab" aria-selected={view === item.id} class:chosen={view === item.id} onclick={() => selectView(item.id)}>{item.label}</button>{/each}
</div>

<section class="panel olap-panel" aria-busy={loading}>
  <div class="panel-heading">
    <div><h2>{activeView.label}</h2><p>{activeView.hint}</p></div>
    {#if view !== 'pivot'}
      <div class="segmented" aria-label="Dimension">{#each Object.entries(HIERARCHIES) as [id, hierarchy]}<button class:chosen={dimension === id} aria-pressed={dimension === id} onclick={() => chooseDimension(id)}>{hierarchy.label}</button>{/each}</div>
    {/if}
  </div>

  {#if view === 'rollup'}
    <div class="olap-controls"><label>Hierarchy depth<select value={depth} onchange={(event) => { depth = Number(event.currentTarget.value); load(); }}>{#each levels.slice(1) as level, index}<option value={index + 2}>{levels.slice(0, index + 2).map((l) => l.label).join(' › ')}</option>{/each}</select></label></div>
  {:else if view === 'pivot'}
    <div class="olap-controls">
      <label>Rows<select value={pivot.rows} onchange={(event) => { pivot.rows = event.currentTarget.value; load(); }}>{#each PIVOT_ROWS as id}<option value={id} disabled={id === pivot.columns}>{PIVOT_DIMENSIONS[id]}</option>{/each}</select></label>
      <label>Columns<select value={pivot.columns} onchange={(event) => { pivot.columns = event.currentTarget.value; load(); }}>{#each PIVOT_COLUMNS as id}<option value={id} disabled={id === pivot.rows}>{PIVOT_DIMENSIONS[id]}</option>{/each}</select></label>
      <label>Measure<select value={pivot.measure} onchange={(event) => { pivot.measure = event.currentTarget.value; load(); }}>{#each MEASURES as measure}<option value={measure.id}>{measure.label}</option>{/each}</select></label>
    </div>
  {/if}

  {#if loading}
    <div class="loading-indicator" role="status">Querying the warehouse… Large selections may take a few minutes.</div>
  {:else if error}
    <div class="error-state" role="alert"><Icon name="info" size={30} /><h2>We couldn't load this query.</h2><p>{error}</p><button class="button button-primary" onclick={() => load(true)}>Try again</button></div>
  {:else if result?.operation === 'hierarchy'}
    <nav class="olap-trail" aria-label="Drill path">
      <button class="trail-step" class:current={path.length === 0} onclick={() => rollUp(0)}>All {HIERARCHIES[dimension].label.toLowerCase()}</button>
      {#each result.breadcrumb as step, index}<Icon name="chevron" size={13} /><button class="trail-step" class:current={index === path.length - 1} onclick={() => rollUp(index + 1)}>{step.label}</button>{/each}
      <span class="trail-level">Showing {result.levelLabel.toLowerCase()} level</span>
      <button class="button button-outline" disabled={!result.canRollUp} onclick={() => rollUp()}>Roll up</button>
    </nav>
    <div class="table-wrap"><table>
      <caption class="sr-only">Members of the {result.levelLabel} level. {result.canDrillDown ? 'Select a row to drill down.' : 'This is the finest level.'}</caption>
      <thead><tr><th><span class="th-text">{result.levelLabel}</span></th><th><span class="th-text">Trips</span></th><th><span class="th-text">Revenue</span></th><th><span class="th-text">Avg. fare</span></th><th><span class="th-text">Trip share</span></th><th><span class="th-text">Rank</span></th>{#if dimension === 'time'}<th><span class="th-text">vs. previous</span></th>{/if}<th><span class="th-text">Cumulative</span></th></tr></thead>
      <tbody>{#each result.rows as row}
        <tr class:drillable={result.canDrillDown}>
          <td>{#if result.canDrillDown}<button class="drill-link" onclick={() => drillDown(row)} title={`Drill down into ${row.label}`}>{row.label}<Icon name="chevron" size={13} /></button>{:else}{row.label}{/if}</td>
          <td>{number(row.trips)}</td><td>{currency(row.revenue)}</td><td>{currency(row.averageFare)}</td>
          <td><span class="table-share">{decimal(row.tripShare)}%<span class="share-track"><span style={`width: ${row.tripShare}%`}></span></span></span></td>
          <td>#{row.rank}</td>
          {#if dimension === 'time'}<td class:negative={row.growth < 0}>{row.growth === null ? '–' : `${row.growth > 0 ? '+' : ''}${decimal(row.growth)}%`}</td>{/if}
          <td>{decimal(row.cumulativeShare)}%</td>
        </tr>
      {:else}<tr><td colspan="8" class="empty-table">No trips match this selection.</td></tr>{/each}</tbody>
      <tfoot><tr><td>Total</td><td>{number(result.summary.trips)}</td><td>{currency(result.summary.revenue)}</td><td>{currency(result.summary.averageFare)}</td><td colspan={dimension === 'time' ? 4 : 3}></td></tr></tfoot>
    </table></div>
  {:else if result?.operation === 'rollup'}
    <div class="table-wrap"><table>
      <caption class="sr-only">Detail rows, subtotals and grand total.</caption>
      <thead><tr><th><span class="th-text">Member</span></th><th><span class="th-text">Row type</span></th><th><span class="th-text">Trips</span></th><th><span class="th-text">Revenue</span></th><th><span class="th-text">Avg. fare</span></th><th><span class="th-text">Share of parent</span></th><th><span class="th-text">Share of total</span></th></tr></thead>
      <tbody>{#each result.rows as row}
        <tr class={`rollup-${row.kind}`}>
          <td style={`padding-left: ${22 + Math.max(0, row.level - 1) * 18}px`}>{row.label}</td>
          <td>{row.kind === 'detail' ? row.levelLabel : row.kind === 'grand' ? 'Grand total' : `${row.levelLabel} subtotal`}</td>
          <td>{number(row.trips)}</td><td>{currency(row.revenue)}</td><td>{currency(row.averageFare)}</td>
          <td>{row.shareOfParent === null ? '–' : `${decimal(row.shareOfParent)}%`}</td><td>{decimal(row.shareOfTotal)}%</td>
        </tr>
      {:else}<tr><td colspan="7" class="empty-table">No trips match this selection.</td></tr>{/each}</tbody>
    </table></div>
  {:else if result?.operation === 'pivot'}
    <div class="table-wrap"><table class="pivot-table">
      <caption class="sr-only">{result.rowLabel} by {result.columnLabel}, measured as {MEASURES.find((m) => m.id === result.measure).label}.</caption>
      <thead><tr><th><span class="th-text">{result.rowLabel} ╲ {result.columnLabel}</span></th>{#each result.columnHeaders as column}<th><span class="th-text">{column.label}</span></th>{/each}<th><span class="th-text">Total</span></th></tr></thead>
      <tbody>{#each result.body as row}
        <tr><td>{row.label}</td>{#each row.cells as cell}<td style={shade(cell)}>{measureText(result.measure, cell)}</td>{/each}<td class="pivot-total">{measureText(result.measure, row.total)}</td></tr>
      {:else}<tr><td colspan={result.columnHeaders.length + 2} class="empty-table">No trips match this selection.</td></tr>{/each}</tbody>
      {#if result.grand}<tfoot><tr><td>Total</td>{#each result.grand.cells as cell}<td>{measureText(result.measure, cell)}</td>{/each}<td>{measureText(result.measure, result.grand.total)}</td></tr></tfoot>{/if}
    </table></div>
  {/if}

  {#if result}
    <p class="report-provenance">Retrieved {new Date(result.meta.generatedAt).toLocaleString()} · Pickup dates in {result.meta.year} · {decimal(result.meta.queryMs / 1000)} s query time{result.meta.cached ? ' · cached' : ''}</p>
    <details class="sql-view"><summary>Show SQL</summary><pre>{result.meta.sql}</pre></details>
  {/if}
</section>
