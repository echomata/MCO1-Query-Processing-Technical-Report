<script>
  import Icon from './Icon.svelte';
  let { label, value, detail, icon, featured = false } = $props();
</script>

<article class:featured class="metric-card">
  <div class="metric-heading"><span>{label}</span><span class="metric-icon"><Icon name={icon} size={18} /></span></div>
  <strong class="metric-value">{value}</strong>
  <span class="metric-detail">{detail}</span>
</article>