<script>
  import Icon from './Icon.svelte';
  import { MONTHS, BOROUGHS, PAYMENTS } from '../lib/config.js';
  let { filters, onapply, onreset, busy = false, error = '' } = $props();
  let draft = $state({});
  $effect(() => { draft = { ...filters }; });
</script>

<form class="filter-panel" onsubmit={(event) => { event.preventDefault(); onapply({ ...draft }); }}>
  <div class="filter-heading"><Icon name="filter" size={18} /><h2>Explore your data</h2><span>2025</span></div>
  <div class="filter-fields">
    <label>From month<select bind:value={draft.startMonth}>{#each MONTHS as month, index}<option value={index + 1}>{month}</option>{/each}</select></label>
    <label>To month<select bind:value={draft.endMonth}>{#each MONTHS as month, index}<option value={index + 1}>{month}</option>{/each}</select></label>
    <label>Pickup borough<select bind:value={draft.borough}><option value="all">All boroughs</option>{#each BOROUGHS as borough}<option value={borough}>{borough}</option>{/each}</select></label>
    <label>Payment method<select bind:value={draft.paymentType}><option value="all">All methods</option>{#each PAYMENTS as payment}<option value={payment.id}>{payment.label}</option>{/each}</select></label>
    <label>Time level<select bind:value={draft.granularity}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Yearly</option></select></label>
    <div class="filter-actions"><button class="button button-primary" type="submit" disabled={busy}>Apply filters<Icon name="arrow" size={16} /></button><button class="button-icon reset-button" type="button" aria-label="Reset all filters" title="Reset all filters" onclick={onreset}><Icon name="reset" size={17} /></button></div>
  </div>
  {#if error}<p class="filter-error" role="alert">{error}</p>{/if}
</form>