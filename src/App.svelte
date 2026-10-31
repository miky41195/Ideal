<script lang="ts">
  import { onMount } from 'svelte';
  import './lib/theme/ideal-dark.css';
  import { workspace as ws } from './lib/state/workspace.svelte';
  import { onCommand, dispatch } from './lib/commands';
  import { routeKey } from './lib/keys/router';
  import { isCommandAllowed } from './lib/keys/gate';
  import TopBar from './lib/layout/TopBar.svelte';
  import ActivityBar from './lib/layout/ActivityBar.svelte';
  import Sidebar from './lib/layout/Sidebar.svelte';
  import StatusBar from './lib/layout/StatusBar.svelte';
  import BottomPanel from './lib/layout/BottomPanel.svelte';
  import Welcome from './lib/layout/Welcome.svelte';
  import EditorArea from './lib/editor/EditorArea.svelte';
  import ClaudeTabs from './lib/claude/ClaudeTabs.svelte';
  import Palette from './lib/palette/Palette.svelte';
  import Toasts from './lib/ui/Toasts.svelte';
  import { settings } from './lib/settings/settings.svelte';

  const project = new URLSearchParams(window.location.search).get('project');
  const name = project ? (project.split(/[\\/]/).filter(Boolean).pop() ?? project) : '';

  function selectView(v: NonNullable<typeof ws.sidebarView>) {
    ws.sidebarView = ws.sidebarView === v ? null : v;
  }

  onMount(() => {
    void settings.init();
    const offs = [
      onCommand('toggleMode', () => ws.toggleMode()),
      onCommand('togglePanel', () => ws.togglePanel()),
      onCommand('newClaudeTab', () => {
        ws.addClaudeTab('new');
        ws.showClaude();
      }),
    ];
    // Terminals handle their own keys; this covers focus outside xterm.
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest?.('.xterm')) return;
      const inEditor = !!target?.closest?.('.cm-editor');
      const cmd = routeKey(
        { code: ev.code, ctrl: ev.ctrlKey, shift: ev.shiftKey, alt: ev.altKey },
        inEditor ? 'editor' : 'other',
      );
      if (cmd && isCommandAllowed(cmd, ws.mode)) {
        ev.preventDefault();
        dispatch(cmd);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offs.forEach((f) => f());
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if !project}
  <Welcome />
{:else}
  <div class="shell">
    <TopBar {name} mode={ws.mode} ontoggle={() => ws.toggleMode()} />
    <div class="row">
      <ActivityBar active={ws.sidebarView} onselect={selectView} />
      {#if ws.sidebarView}<Sidebar view={ws.sidebarView} projectPath={project} />{/if}
      <div class="center">
        <div class="main">
          <!-- Claude stays mounted in both modes so sessions persist. -->
          <div class="claude" class:off={ws.mode !== 'claude'}>
            <ClaudeTabs {ws} cwd={project} visible={ws.mode === 'claude'} />
          </div>
          <!-- Editor stays mounted too, so per-tab state survives mode switches. -->
          <div class="editor" class:off={ws.mode !== 'editor'}>
            <EditorArea visible={ws.mode === 'editor'} />
          </div>
        </div>
        <BottomPanel cwd={project} open={ws.panelOpen} />
      </div>
    </div>
    <StatusBar mode={ws.mode} path={project} />
    <Palette />
  </div>
{/if}
<Toasts />

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .row {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .main {
    flex: 1;
    position: relative;
    min-height: 0;
  }
  .claude {
    position: absolute;
    inset: 0;
  }
  .claude.off,
  .editor.off {
    visibility: hidden;
    pointer-events: none;
  }
  .editor {
    position: absolute;
    inset: 0;
  }
</style>
