<script>
  import Icon from './Icon.svelte';
  import { REPORTS } from '../lib/config.js';
  let { selected, onselect, open = false, onclose, sourceLabel = 'CONNECTING' } = $props();
</script>

{#if open}<button class="sidebar-scrim" aria-label="Close navigation" onclick={onclose}></button>{/if}
<aside id="report-sidebar" class:open class="sidebar">
  <a class="brand" href="#overview" onclick={(event) => { event.preventDefault(); onselect('overview'); }} aria-label="Meter overview">
    <span class="brand-mark">m<span>.</span></span>
    <span class="brand-name">meter<span>NYC TAXI ANALYTICS</span></span>
  </a>
  <div class="sidebar-heading">WORKSPACE</div>
  <nav class="report-nav" aria-label="Analytical reports">
    {#each REPORTS as report}
      <button class:active={selected === report.id} aria-current={selected === report.id ? 'page' : undefined} onclick={() => onselect(report.id)}>
        <Icon name={report.icon} /><span>{report.label}</span>
        {#if selected === report.id}<span class="nav-indicator"></span>{/if}
      </button>
    {/each}
  </nav>
  <div class="sidebar-note">
    <span class="small-kicker">YEAR</span>
    <div class="sidebar-year">2025</div>
  </div>
  <div class="sidebar-bottom">
    <div class="data-status"><span class="status-dot"></span><span>{sourceLabel === 'LIVE DATABASE' ? 'Live warehouse connected' : sourceLabel === 'CONNECTING' ? 'Connecting to warehouse…' : 'Warehouse unavailable'}</span></div>
    <div class="project-label">STADVDB <span>MCO1 / GROUP PROJECT</span></div>
  </div>
</aside>