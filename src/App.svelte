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
  import PluginBanner from './lib/layout/PluginBanner.svelte';
  import StatusBar from './lib/layout/StatusBar.svelte';
  import BottomPanel from './lib/layout/BottomPanel.svelte';
  import Welcome from './lib/layout/Welcome.svelte';
  import EditorArea from './lib/editor/EditorArea.svelte';
  import ClaudeTabs from './lib/claude/ClaudeTabs.svelte';
  import Palette from './lib/palette/Palette.svelte';
  import QuickOpen from './lib/search/QuickOpen.svelte';
  import Toasts from './lib/ui/Toasts.svelte';
  import { settings, settingsPath } from './lib/settings/settings.svelte';
  import { registerCommands, formatBinding, type PaletteCommand } from './lib/palette/registry';
  import type { Command } from './lib/keys/router';
  import { showToast } from './lib/ui/toast.svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { ask } from '@tauri-apps/plugin-dialog';
  import { initGit, git } from './lib/git/git-store.svelte';
  import { fsWatch } from './lib/fs-client';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { tabs, hasUnsaved } from './lib/editor/tabs.svelte';
  import { createBackupScheduler, backupWrite, backupClear, backupClearAll, backupList, restoreBackups } from './lib/editor/hot-exit';
  import { hub } from './lib/hub/hub-store.svelte';
  import { health } from './lib/hub/health.svelte';
  import { onTerminalActivity, debounce } from './lib/terminal/activity';

  const project = new URLSearchParams(window.location.search).get('project');
  const name = project ? (project.split(/[\\/]/).filter(Boolean).pop() ?? project) : '';

  const isFileActive = () => ws.mode === 'editor' && !!tabs.active && (tabs.active.kind ?? 'file') === 'file';
  const bus = (id: string, label: string, cmd: Command, when?: () => boolean): PaletteCommand => ({
    id,
    label,
    run: () => dispatch(cmd),
    when,
    keys: formatBinding(cmd),
  });
  const showView = (id: string, label: string, v: NonNullable<typeof ws.sidebarView>): PaletteCommand => ({
    id,
    label,
    run: () => {
      ws.sidebarView = v;
    },
  });
  const builtins: PaletteCommand[] = [
    bus('toggleMode', 'Passa a Claude / Editor', 'toggleMode'),
    bus('togglePanel', 'Mostra/nascondi terminale', 'togglePanel'),
    bus('newClaudeTab', 'Nuova tab Claude', 'newClaudeTab'),
    {
      id: 'resumeLast',
      label: 'Riprendi ultima sessione Claude',
      run: () => {
        ws.addClaudeTab('continue');
        ws.showClaude();
      },
    },
    bus('quickOpen', 'Apri file…', 'quickOpenAny'),
    bus('searchProject', 'Cerca nel progetto', 'searchProject'),
    bus('save', 'Salva', 'save', isFileActive),
    bus('saveAll', 'Salva tutto', 'saveAll', () => ws.mode === 'editor'),
    bus('closeTab', 'Chiudi tab', 'closeTab', () => ws.mode === 'editor' && !!tabs.active),
    {
      id: 'openSettings',
      label: 'Apri settings.json',
      run: async () => {
        try {
          await tabs.openFile(await settingsPath());
          ws.showEditor();
        } catch (e) {
          showToast(`Impossibile aprire settings.json: ${e}`);
        }
      },
    },
    showView('viewExplorer', 'Mostra Esplora file', 'explorer'),
    showView('viewGit', 'Mostra Git', 'git'),
    {
      id: 'viewHeatmap',
      label: 'Mostra Heatmap',
      run: () => {
        tabs.openHeatmap();
        ws.showEditor();
      },
    },
    showView('viewHub', 'Mostra Claude Hub', 'hub'),
    showView('viewNotes', 'Mostra Note', 'notes'),
  ];

  function selectView(v: NonNullable<typeof ws.sidebarView>) {
    ws.sidebarView = ws.sidebarView === v ? null : v;
  }

  // Refresh git when the workspace mode toggles (no polling).
  $effect(() => {
    void ws.mode;
    if (project) void git.refresh();
  });

  onMount(() => {
    void settings.init();
    // Claude/shell edits files without going through the editor: refresh once output goes idle.
    const idleRefresh = debounce(() => void git.refresh(), 1500);
    const offs = [
      registerCommands(builtins),
      tabs.onSaved(() => void git.refresh()),
      onTerminalActivity(idleRefresh),
      idleRefresh.cancel,
      onCommand('toggleMode', () => ws.toggleMode()),
      onCommand('togglePanel', () => ws.togglePanel()),
      onCommand('searchProject', () => {
        // SearchPanel focuses itself on mount, or via the same command when already shown.
        ws.sidebarView = 'search';
      }),
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
    let offClose: (() => void) | undefined;
    let offGit: (() => void) | undefined;
    let offFs: (() => void) | undefined;
    let disposed = false;
    if (project) {
      hub.projectPath = project;
      const scheduler = createBackupScheduler(
        (path, content, eol) => backupWrite(project, path, content, eol),
        (path) => backupClear(project, path),
      );
      tabs.setBackupSink(scheduler);
      offs.push(() => tabs.setBackupSink(null));
      void backupList(project)
        .then((list) => restoreBackups(tabs, list, (p) => void backupClear(project, p).catch(() => {})))
        .then((count) => {
          if (count > 0) showToast(`Ripristinate ${count} modifiche non salvate`);
        })
        .catch((e) => console.warn('hot exit restore failed', e));
      offs.push(health.init());
      void getCurrentWebviewWindow()
        .listen<{ paths: string[] }>('fs://changed', (e) => void tabs.onDiskChanged(e.payload.paths))
        .then((f) => (disposed ? f() : (offFs = f)))
        .then(() => fsWatch(project))
        .catch((e) => console.warn('fs watch failed', e));
      void initGit(project).then((f) => (disposed ? f() : (offGit = f)));
      void getCurrentWindow()
        .onCloseRequested(async (e) => {
          if (!hasUnsaved(tabs.tabs)) return;
          // Hot exit: persist unsaved buffers and close without asking; ask only if that fails.
          try {
            await scheduler.flush();
            return;
          } catch (err) {
            console.warn('hot exit flush failed', err);
          }
          const ok = await ask('Ci sono modifiche non salvate. Chiudere senza salvare?', {
            title: 'Ideal',
            kind: 'warning',
          });
          if (!ok) e.preventDefault();
          else void backupClearAll(project).catch(() => {});
        })
        .then((f) => (offClose = f));
    }
    return () => {
      disposed = true;
      offGit?.();
      offFs?.();
      offClose?.();
      offs.forEach((f) => f());
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if !project}
  <Welcome />
{:else if settings.ready}
  <div class="shell">
    <TopBar {name} mode={ws.mode} ontoggle={() => ws.toggleMode()} />
    <PluginBanner />
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
    <QuickOpen projectPath={project} />
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
