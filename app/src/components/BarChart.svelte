<script>
  import { compact, currency, number } from '../lib/format.js';
  let { rows = [], measure = 'trips', horizontal = false } = $props();
  const valueFor = (row) => measure === 'revenue' ? row.revenue : row.trips;
  let maximum = $derived(Math.max(...rows.map(valueFor), 1) * 1.15);
  const format = (value) => compact(value, measure === 'revenue');
</script>

{#if rows.length === 0}
  <div class="empty-state">No trips match this selection. Try changing your filters.</div>
{:else if horizontal}
  <div class="horizontal-chart" role="img" aria-label={rows.map((row) => `${row.label}: ${measure === 'revenue' ? currency(valueFor(row)) : number(valueFor(row))}`).join('; ')}>
    {#each rows.slice(0, 10) as row, index}
      <div class="horizontal-row"><div class="horizontal-label"><span>{row.label}</span><strong>{format(valueFor(row))}</strong></div><div class="horizontal-track"><span class:secondary={index > 0} style={`width: ${valueFor(row) / maximum * 100}%`}></span></div></div>
    {/each}
  </div>
{:else}
  <div class="column-chart" role="img" aria-label={rows.map((row) => `${row.label}: ${measure === 'revenue' ? currency(valueFor(row)) : number(valueFor(row))}`).join('; ')}>
    <div class="y-axis">{#each [1, 0.75, 0.5, 0.25, 0] as fraction}<span>{format(maximum * fraction)}</span>{/each}</div>
    <div class="chart-plot">
      <div class="chart-grid">{#each [1, 2, 3, 4, 5] as line}<span></span>{/each}</div>
      <div class="columns">
        {#each rows as row, index}
          <div class="column"><div class="bar-slot"><div class="chart-bar" class:highlight={valueFor(row) === Math.max(...rows.map(valueFor))} style={`height: ${valueFor(row) / maximum * 100}%`} title={`${row.label}: ${measure === 'revenue' ? currency(valueFor(row)) : number(valueFor(row))}`}><span class="bar-value">{format(valueFor(row))}</span></div></div><span class="x-label">{row.label}</span></div>
        {/each}
      </div>
    </div>
  </div>
{/if}