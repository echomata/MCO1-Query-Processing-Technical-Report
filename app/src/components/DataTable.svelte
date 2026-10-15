<script>
  import { currency, decimal, number } from '../lib/format.js';
  let { rows = [], label = 'Period' } = $props();
  let sortKey = $state('');
  let direction = $state(-1);
  let sorted = $derived.by(() => [...rows].sort((a, b) => !sortKey ? 0 : direction * (typeof a[sortKey] === 'string' ? a[sortKey].localeCompare(b[sortKey]) : a[sortKey] - b[sortKey])));
  let columns = $derived([{ key: 'label', label }, { key: 'trips', label: 'Trips' }, { key: 'revenue', label: 'Total revenue' }, { key: 'averageFare', label: 'Avg. fare' }, { key: 'share', label: 'Trip share' }]);
  function sort(key) { if (sortKey === key) direction *= -1; else { sortKey = key; direction = key === 'label' ? 1 : -1; } }
</script>

<div class="table-wrap">
  <table>
    <caption class="sr-only">Report results. Select a column heading to sort.</caption>
    <thead><tr>{#each columns as column}<th aria-sort={sortKey === column.key ? direction === 1 ? 'ascending' : 'descending' : 'none'}><button onclick={() => sort(column.key)}>{column.label}<span aria-hidden="true">{sortKey === column.key ? direction === 1 ? '↑' : '↓' : '↕'}</span></button></th>{/each}</tr></thead>
    <tbody>{#each sorted as row}<tr><td>{row.label}</td><td>{number(row.trips)}</td><td>{currency(row.revenue)}</td><td>{currency(row.averageFare)}</td><td><span class="table-share">{decimal(row.share)}%<span class="share-track"><span style={`width: ${row.share}%`}></span></span></span></td></tr>{:else}<tr><td colspan="5" class="empty-table">No results for this selection.</td></tr>{/each}</tbody>
  </table>
</div>