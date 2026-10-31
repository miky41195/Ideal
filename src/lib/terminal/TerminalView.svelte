<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { spawnPty, writePty, resizePty, killPty, type PtyKind } from './pty-client';
  import { safeDims } from './dims';
  import { routeKey } from '../keys/router';
  import { dispatch } from '../commands';

  let { kind, cwd, visible = true }: { kind: PtyKind; cwd: string; visible?: boolean } = $props();

  let host: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let ptyId: number | null = null;
  let destroyed = false;
  let lastSent = { cols: 0, rows: 0 };

  function refit() {
    if (!term || !fit || !host || host.clientWidth === 0 || host.clientHeight === 0) return;
    fit.fit();
    const d = safeDims(term.cols, term.rows);
    if (!d || ptyId === null) return;
    if (d.cols === lastSent.cols && d.rows === lastSent.rows) return;
    lastSent = d;
    resizePty(ptyId, d.cols, d.rows).catch(() => {});
  }

  onMount(() => {
    const t = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host);
    term = t;
    fit = f;

    t.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      const cmd = routeKey(
        { key: ev.key, ctrl: ev.ctrlKey, shift: ev.shiftKey, alt: ev.altKey },
        'terminal',
      );
      if (cmd) {
        ev.preventDefault();
        dispatch(cmd);
        return false;
      }
      return true;
    });

    // Wire input before spawn so ConPTY's ESC[6n reply is never lost.
    t.onData((s) => {
      if (ptyId !== null) writePty(ptyId, s).catch(() => {});
    });

    let initial = { cols: 80, rows: 24 };
    if (host.clientWidth > 0 && host.clientHeight > 0) {
      f.fit();
      initial = safeDims(t.cols, t.rows) ?? initial;
    }

    spawnPty(
      kind,
      cwd,
      initial.cols,
      initial.rows,
      (s) => t.write(s),
      (code) => t.write(`\r\n[processo terminato${code === null ? '' : ` con codice ${code}`}]\r\n`),
    )
      .then((id) => {
        if (destroyed) {
          killPty(id).catch(() => {});
          return;
        }
        ptyId = id;
        lastSent = initial;
        refit();
      })
      .catch((e) => t.write(`\r\n[errore avvio terminale: ${e}]\r\n`));

    const ro = new ResizeObserver(() => refit());
    ro.observe(host);

    return () => {
      destroyed = true;
      ro.disconnect();
      if (ptyId !== null) killPty(ptyId).catch(() => {});
      ptyId = null;
      t.dispose();
      term = undefined;
    };
  });

  $effect(() => {
    if (visible) {
      refit();
      term?.focus();
    }
  });
</script>

<div class="term" bind:this={host} class:hidden={!visible}></div>

<style>
  .term {
    width: 100%;
    height: 100%;
  }
  .hidden {
    visibility: hidden;
  }
</style>
