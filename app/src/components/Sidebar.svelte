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
        <Icon name={report.icon} /><span>{report.label}{#if report.wip} <small class="wip-tag">(WIP)</small>{/if}</span>
        {#if selected === report.id}<span class="nav-indicator"></span>{/if}
      </button>
    {/each}
  </nav>
  <div class="sidebar-note">
    <span class="small-kicker">A YEAR IN MOTION</span>
    <div class="sidebar-year">2025<span>NYC</span></div>
    <p>One city. Millions of journeys.<br />A clearer view of how it moves.</p>
    <div class="taxi-stripe"></div>
  </div>
  <div class="sidebar-bottom">
    <div class="data-status"><span class="status-dot"></span><span>{sourceLabel === 'LIVE DATABASE' ? 'Live warehouse connected' : sourceLabel === 'CONNECTING' ? 'Connecting to warehouse…' : sourceLabel === 'WIP' ? 'Work in progress' : 'Warehouse unavailable'}</span></div>
    <div class="project-label">STADVDB <span>MCO1 / GROUP PROJECT</span></div>
  </div>
</aside>