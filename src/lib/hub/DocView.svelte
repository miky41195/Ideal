<script lang="ts">
  import { renderMarkdown } from '../markdown/render';

  let { markdown }: { markdown: string } = $props();
  const html = $derived(renderMarkdown(markdown));

  function onclick(e: MouseEvent) {
    if ((e.target as HTMLElement | null)?.closest('a')) e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="doc md" {onclick}>{@html html}</div>

<style>
  .doc {
    overflow: auto;
    padding: 16px 24px;
    color: var(--text);
    line-height: 1.55;
    user-select: text;
  }
  .doc :global(pre) {
    background: var(--panel-2);
    padding: 8px 12px;
    border-radius: 4px;
    overflow-x: auto;
  }
  .doc :global(code) {
    font-family: var(--mono, monospace);
  }
  .doc :global(a) {
    color: var(--accent);
  }
  .doc :global(table) {
    border-collapse: collapse;
  }
  .doc :global(th),
  .doc :global(td) {
    border: 1px solid var(--border);
    padding: 2px 8px;
  }
</style>
