<script>
  let { name = 'overview', size = 20 } = $props();
  const paths = {
    overview: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
    chart: ['M4 3v17h17', 'M8 14l4-4 4 2 5-7'],
    pin: ['M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
    wallet: ['M4 5h15v15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13v2', 'M15 10h6v6h-6z', 'M17 13h1'],
    arrow: ['M5 12h14', 'm14 7 5 5-5 5'],
    chevron: ['m9 5 7 7-7 7'],
    download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 16v5h16v-5'],
    reset: ['M3 10a9 9 0 1 1 2 8', 'M3 4v6h6'],
    clock: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'M12 6v6l4 2'],
    taxi: ['M4 10l2-5h12l2 5', 'M3 10h18v8H3z', 'M5 18v3', 'M19 18v3', 'M6 14h2', 'M16 14h2', 'M10 5V2h4v3'],
    filter: ['M3 5h18', 'M6 12h12', 'M9 19h6'],
    money: ['M12 2v20', 'M17 6H9a4 4 0 0 0 0 8h6a4 4 0 0 0 0-8', 'M7 18h8a4 4 0 0 0 0-8'],
    distance: ['M3 12h18', 'm7 8-4 4 4 4', 'm17 8 4 4-4 4'],
    info: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'M12 11v6', 'M12 7h.01'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    close: ['m6 6 12 12', 'M18 6 6 18'],
    sort: ['m8 4-4 4-4-4', 'M4 8V1', 'm16 20 4-4 4 4', 'M20 16v7'],
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each paths[name] ?? paths.overview as path}<path d={path} />{/each}
</svg>