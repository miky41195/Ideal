<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import './lib/theme/base.css';
  import { workspace as ws } from './lib/state/workspace.svelte';
  import { onCommand, dispatch } from './lib/commands';
  import { routeKey } from './lib/keys/router';
  import { isCommandAllowed } from './lib/keys/gate';
  import TopBar from './lib/layout/TopBar.svelte';
  import DockStage from './lib/dock/DockStage.svelte';
  import PluginBanner from './lib/layout/PluginBanner.svelte';
  import StatusBar from './lib/layout/StatusBar.svelte';
  import Welcome from './lib/layout/Welcome.svelte';
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
  import { lsp } from './lib/lsp/lsp-manager.svelte';
  import { health } from './lib/hub/health.svelte';
  import { onTerminalActivity, debounce } from './lib/terminal/activity';
  import { dock } from './lib/dock/dock.svelte';
  import type { BlockId, Zone } from './lib/dock/dock-tree';
  import { THEMES, applyTheme } from './lib/theme/themes';
  import { parseKeybindings } from './lib/keys/user-bindings';
  import { setBindings } from './lib/keys/router';
  import { listen } from '@tauri-apps/api/event';
  import { themeState } from './lib/theme/theme-state.svelte';
  import { invoke } from '@tauri-apps/api/core';

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
  const showView = (id: string, label: string, b: BlockId): PaletteCommand => ({ id, label, run: () => dock.show(b) });
  const moveTo = (zone: Zone, label: string): PaletteCommand => ({
    id: `moveBlock-${zone}`,
    label: `Sposta blocco attivo ${label}`,
    run: () => dock.move(dock.focused, 'root', zone),
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
    {
      id: 'openKeybindings',
      label: 'Apri keybindings.json',
      run: async () => {
        try {
          await tabs.openFile(await invoke<string>('keybindings_path'));
          ws.showEditor();
        } catch (e) {
          showToast(`Impossibile aprire keybindings.json: ${e}`);
        }
      },
    },
    showView('viewChanges', 'Mostra Modifiche della sessione', 'changes'),
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
    moveTo('left', 'a sinistra'),
    moveTo('right', 'a destra'),
    moveTo('top', 'in alto'),
    moveTo('bottom', 'in basso'),
    { id: 'resetLayout', label: 'Ripristina disposizione blocchi', run: () => dock.reset() },
    ...THEMES.map((t) => ({ id: `theme-${t.id}`, label: `Tema: ${t.label}`, run: () => void settings.setTheme(t.id) })),
  ];

  async function loadKeybindings() {
    try {
      const { bindings, errors } = parseKeybindings(await invoke<string | null>('get_keybindings'));
      setBindings(bindings);
      if (errors.length) showToast(errors.join(' · '));
    } catch (e) {
      console.warn('keybindings load failed', e);
    }
  }

  $effect(() => {
    const theme = themeState.theme;
    applyTheme(theme);
    // Native title bar takes the canvas colour on Windows 11; older systems ignore it.
    void invoke('set_window_chrome', { caption: theme.canvas, text: theme.canvasText }).catch(() => {});
    if (settings.ready && !themeState.preview) {
      try {
        localStorage.setItem('ideal.theme', theme.id);
      } catch {
        /* storage unavailable */
      }
    }
  });

  // Asked to show Claude or the editor: bring its block forward and give it the keyboard.
  $effect(() => {
    void ws.reveal;
    const m = untrack(() => ws.mode);
    untrack(() => dock.show(m));
    dock.focused = m;
    queueMicrotask(() => {
      const sel = m === 'claude' ? '.slot:not(.off) textarea' : '.cm-content';
      document.querySelector<HTMLElement>(`[data-block="${m}"] ${sel}`)?.focus();
    });
  });

  // Refresh git when the workspace mode toggles (no polling).
  $effect(() => {
    void ws.mode;
    if (project) void git.refresh();
  });

  onMount(() => {
    void settings.init();
    void loadKeybindings();
    const offKeys = listen('keybindings://changed', () => void loadKeybindings());
    // Claude/shell edits files without going through the editor: refresh once output goes idle.
    const idleRefresh = debounce(() => void git.refresh(), 1500);
    const offs = [
      registerCommands(builtins),
      tabs.onSaved(() => void git.refresh()),
      onTerminalActivity(idleRefresh),
      idleRefresh.cancel,
      onCommand('toggleMode', () => ws.toggleMode()),
      onCommand('togglePanel', () => dock.toggle('terminal')),
      onCommand('searchProject', () => {
        // SearchPanel focuses itself on mount, or via the same command when already shown.
        dock.show('search');
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
          if (count > 0) showToast(count === 1 ? 'Ripristinata 1 modifica non salvata' : `Ripristinate ${count} modifiche non salvate`);
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
      void offKeys.then((f) => f());
      void lsp.stopAll();
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
    <TopBar {name} path={project} />
    <PluginBanner />
    <div class="row">
      <DockStage {project} />
    </div>
    <StatusBar mode={ws.mode} />
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
    gap: var(--gap);
    min-height: 0;
    padding: 0 var(--gap);
  }
</style>
