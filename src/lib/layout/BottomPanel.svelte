<script lang="ts">
  import TerminalView from '../terminal/TerminalView.svelte';
  import { settings } from '../settings/settings.svelte';
  import Splitter from './Splitter.svelte';
  let { cwd, open }: { cwd: string; open: boolean } = $props();
  let height = $state(240);
</script>

<!-- Kept mounted when closed so the shell survives toggling. -->
<section class:closed={!open}>
  <Splitter {height} onresize={(h) => (height = h)} />
  <div class="body" style:height="{height}px">
    <TerminalView kind={{ type: 'Shell', program: settings.value.terminal.shell }} {cwd} visible={open} />
  </div>
</section>

<style>
  section {
    flex: none;
    background: var(--bg);
  }
  section.closed {
    display: none;
  }
</style>
