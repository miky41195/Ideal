<script lang="ts" module>
  // One drawn set: 24 grid, 1.75 stroke, round joins.
  const PATHS = {
    files: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.5h7A1.5 1.5 0 0 1 20 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z',
    branch: 'M7 4v11M7 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 9c0 4-4 4.5-10 6',
    grid: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
    search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.3-4.3',
    note: 'M6 4h12a1.5 1.5 0 0 1 1.5 1.5V15l-5 5H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4zM14.5 20v-5h5M8.5 9h7M8.5 13h3',
    spark: 'M12 3.5l1.9 5.6a1.5 1.5 0 0 0 1 1l5.6 1.9-5.6 1.9a1.5 1.5 0 0 0-1 1L12 20.5l-1.9-5.6a1.5 1.5 0 0 0-1-1L3.5 12l5.6-1.9a1.5 1.5 0 0 0 1-1z',
    terminal: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 5zM7.5 9.5L10.5 12l-3 2.5M12.5 15h4',
    code: 'M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18',
    close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
    plus: 'M12 5.5v13M5.5 12h13',
    minus: 'M6 12h12',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    chevronRight: 'M9.5 6l6 6-6 6',
    chevronDown: 'M6 9.5l6 6 6-6',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
    pin: 'M12 15v5M8 4h8l-1 6 2.5 3v2h-11v-2L9 10z',
    swatch: 'M12 4a8 8 0 1 0 0 16c1.2 0 1.8-.8 1.8-1.7 0-.9-.6-1.3-.6-2.1 0-.9.7-1.5 1.6-1.5h2A3.2 3.2 0 0 0 20 11.5C20 7.4 16.4 4 12 4zM8 11.5h.01M10.5 8h.01M15 8.5h.01',
    refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9M19.5 4.5V9H15',
    filePlus: 'M7 3.5h6.5L18 8v12a.5.5 0 0 1-.5.5h-10.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM13 3.5V8.5h5M12 11.5v5M9.5 14h5',
    folderPlus: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.5h7A1.5 1.5 0 0 1 20 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 10.5v5M9.5 13h5',
    layers: 'M12 4l8.5 4.5L12 13 3.5 8.5zM3.5 12.5L12 17l8.5-4.5M3.5 16L12 20.5l8.5-4.5',
    calendar: 'M5.5 5.5h13A1.5 1.5 0 0 1 20 7v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5zM4 10h16M8.5 3.5v4M15.5 3.5v4',
    blocks: 'M4.5 4.5h7v9h-7zM14 4.5h5.5v5H14zM14 12h5.5v7.5H14zM4.5 16h7v3.5h-7z',
    undo: 'M8.5 6L4.5 10l4 4M4.5 10H14a5 5 0 0 1 0 10h-3',
    diff: 'M8 4v10M3.5 9h9M12.5 20h8M16 4l4.5 4.5L16 13',
    up: 'M12 19V6M6.5 11.5L12 6l5.5 5.5',
    down: 'M12 5v13M6.5 12.5L12 18l5.5-5.5',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={PATHS[name]} />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
