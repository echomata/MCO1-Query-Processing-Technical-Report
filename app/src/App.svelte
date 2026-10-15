<script>
  import { onMount } from 'svelte';
  import Icon from './components/Icon.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import FilterPanel from './components/FilterPanel.svelte';
  import MetricCard from './components/MetricCard.svelte';
  import BarChart from './components/BarChart.svelte';
  import DataTable from './components/DataTable.svelte';
  import { DEFAULT_FILTERS, MONTHS, PAYMENTS, REPORTS } from './lib/config.js';
  import { compact, currency, decimal } from './lib/format.js';
  import { getReport, validateFilters } from './services/reportService.js';

  let selected = $state('overview');
  let filters = $state({ ...DEFAULT_FILTERS });
  let report = $state(null);
  let loading = $state(true);
  let error = $state('');
  let filterError = $state('');
  let measure = $state('trips');
  let menuOpen = $state(false);
  let requestController;
  let activeReport = $derived(REPORTS.find((item) => item.id === selected));
  let rangeLabel = $derived(`${MONTHS[filters.startMonth - 1].slice(0, 3)} – ${MONTHS[filters.endMonth - 1].slice(0, 3)} ${filters.year}`);
  let isTime = $derived(selected === 'overview' || selected === 'time');
  let chartTitle = $derived(selected === 'locations' ? `${measure === 'trips' ? 'Trips' : 'Revenue'} by pickup zone` : selected === 'payments' ? 'Payment breakdown' : measure === 'trips' ? 'Trip activity' : 'Revenue activity');
  let rowLabel = $derived(selected === 'locations' ? 'Pickup zone' : selected === 'payments' ? 'Payment method' : 'Period');

  async function loadReport() {
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    loading = true;
    error = '';
    try {
      const result = await getReport(selected, { ...filters }, { signal: controller.signal });
      if (!controller.signal.aborted) report = result;
    } catch (problem) {
      if (problem.name !== 'AbortError') error = problem.message || 'Unable to load this report. Please try again.';
    } finally { if (!controller.signal.aborted) loading = false; }
  }

  function selectReport(id) { selected = id; menuOpen = false; loadReport(); }
  function applyFilters(next) {
    try { filters = validateFilters(next); filterError = ''; loadReport(); }
    catch (problem) { filterError = problem.message; }
  }
  function resetFilters() { applyFilters({ ...DEFAULT_FILTERS }); }

  function exportReport() {
    if (!report || loading || error) return;
    const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const lines = [
      ['Source', 'Synthetic sample data - not actual TLC results'],
      ['Year', filters.year, 'Months', `${filters.startMonth}-${filters.endMonth}`, 'Borough', filters.borough, 'Payment', filters.paymentType, 'Time level', filters.granularity],
      [], [rowLabel, 'Trips', 'Revenue (USD)', 'Average fare (USD)', 'Trip share (%)'],
      ...report.series.map((row) => [row.label, row.trips, row.revenue.toFixed(2), row.averageFare.toFixed(2), row.share.toFixed(2)]),
    ];
    const blob = new Blob([lines.map((line) => line.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `meter-demo-${selected}-2025.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  onMount(() => { loadReport(); return () => requestController?.abort(); });
</script>

<svelte:head><title>{activeReport.label} | Meter NYC Taxi Analytics</title></svelte:head>
<svelte:window onkeydown={(event) => { if (event.key === 'Escape') menuOpen = false; }} />
<a class="skip-link" href="#main">Skip to dashboard</a>
<Sidebar {selected} onselect={selectReport} open={menuOpen} onclose={() => menuOpen = false} />
<div class="app-content">
  <header class="topbar">
    <div class="breadcrumb"><button class="button-icon mobile-menu" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="report-sidebar" onclick={() => menuOpen = true}><Icon name="menu" /></button><span>Workspace</span><Icon name="chevron" size={14} /><strong>{activeReport.label}</strong></div>
    <div class="topbar-right"><span class="demo-pill"><span></span>DEMO DATA</span><div class="avatar" aria-label="STADVDB project">ST</div></div>
  </header>
  <main id="main" tabindex="-1">
    <section class="page-intro">
      <div><p class="eyebrow">NYC YELLOW TAXI / ANNUAL EXPLORER</p><h1>{activeReport.title}</h1><p class="intro-description">{activeReport.description}</p></div>
      <button class="button button-outline export-button" disabled={loading || !report || !!error} onclick={exportReport}><Icon name="download" size={17} />Export report</button>
    </section>
    <div class="demo-notice"><Icon name="info" size={17} /><p><strong>Preview with sample data.</strong> These figures are illustrative. Real NYC Taxi results will appear when the backend is connected.</p></div>
    <FilterPanel {filters} onapply={applyFilters} onreset={resetFilters} busy={loading} error={filterError} />
    <div class="selection-line"><span><span class="selection-dot"></span>{rangeLabel}<span class="divider">/</span>{filters.borough === 'all' ? 'All boroughs' : filters.borough}<span class="divider">/</span>{filters.paymentType === 'all' ? 'All payment methods' : PAYMENTS.find((p) => p.id === filters.paymentType)?.label}</span><span class="selection-count">{isTime ? `${filters.granularity.charAt(0).toUpperCase() + filters.granularity.slice(1)} level` : activeReport.label}</span></div>
    <section class="report-content" aria-busy={loading} aria-label="Report results">
      {#if loading}
        <div class="loading-indicator" role="status">Loading report…</div><div class="metrics-grid skeleton-grid" aria-hidden="true">{#each [1, 2, 3, 4] as card}<div class="skeleton skeleton-card"></div>{/each}</div><div class="skeleton skeleton-chart" aria-hidden="true"></div>
      {:else if error}
        <div class="error-state" role="alert"><Icon name="info" size={30} /><h2>We couldn't load this report.</h2><p>{error}</p><button class="button button-primary" onclick={loadReport}>Try again</button></div>
      {:else if report}
        <div class="metrics-grid">
          <MetricCard label="Total trips" value={compact(report.summary.totalTrips)} detail="Trips in your selection" icon="taxi" featured />
          <MetricCard label="Total revenue" value={compact(report.summary.totalRevenue, true)} detail="Total trip charges · USD" icon="money" />
          <MetricCard label="Average fare" value={currency(report.summary.averageFare)} detail="Fare per trip · USD" icon="wallet" />
          <MetricCard label="Average distance" value={`${decimal(report.summary.averageDistance)} mi`} detail={`${decimal(report.summary.averageDuration)} min average duration`} icon="distance" />
        </div>
        <div class="visual-grid" class:single={selected !== 'overview'}>
          <section class="panel primary-chart"><div class="panel-heading"><div><h2>{chartTitle}</h2><p>{isTime ? 'A closer look at how demand changes over time.' : 'Compare activity within the selected filters.'}</p></div><div class="segmented" aria-label="Chart measure"><button class:chosen={measure === 'trips'} aria-pressed={measure === 'trips'} onclick={() => measure = 'trips'}>Trips</button><button class:chosen={measure === 'revenue'} aria-pressed={measure === 'revenue'} onclick={() => measure = 'revenue'}>Revenue</button></div></div><div class="chart-legend"><span class="legend-swatch"></span>{measure === 'trips' ? 'Trip count' : 'Revenue (USD)'}<span class="chart-period">{rangeLabel}</span></div><BarChart rows={report.series} {measure} horizontal={!isTime} /></section>
          {#if selected === 'overview'}
            <section class="panel borough-panel"><div class="panel-heading"><div><h2>Borough snapshot</h2><p>Where journeys begin.</p></div><Icon name="pin" size={20} /></div><div class="borough-list">{#each report.boroughs as borough, index}<div class="borough-item"><div class="borough-rank">{String(index + 1).padStart(2, '0')}</div><div class="borough-body"><div><strong>{borough.label}</strong><span>{compact(borough.trips)}</span></div><div class="borough-track"><span style={`width: ${borough.share}%`} class:leading={index === 0}></span></div></div></div>{/each}</div><button class="text-button" onclick={() => selectReport('locations')}>Explore locations<Icon name="arrow" size={16} /></button></section>
          {/if}
        </div>
        <section class="panel results-panel"><div class="panel-heading"><div><div class="results-title"><h2>The details</h2><span class="row-count">{report.series.length} rows</span></div><p>Exact values behind the visualization.</p></div><span class="table-unit">Revenue & fares in USD</span></div><DataTable rows={report.series} label={rowLabel} /></section>
      {/if}
    </section>
    <footer class="page-footer"><span><strong>meter</strong> / NYC Taxi Analytics</span><span>STADVDB MCO1 <span class="divider">·</span> Frontend preview</span></footer>
  </main>
</div>