<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, Compartment, Transaction, type Extension } from '@codemirror/state';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
  } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
  import {
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
  } from '@codemirror/language';
  import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
  import { baseTheme, highlightingExt } from './theme';
  import { languageFor } from './languages';
  import { settings } from '../settings/settings.svelte';
  import { tabs, remapPath, type EditorTab } from './tabs.svelte';
  import { clampSelection } from './disk-policy';

  let {
    tab,
    onchange,
    isOpen,
    visible = true,
  }: {
    tab: EditorTab;
    onchange: (path: string, content: string) => void;
    isOpen: (path: string) => boolean;
    visible?: boolean;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  // One EditorState per tab keeps undo history and selection across switches.
  const states = new Map<string, EditorState>();
  const lang = new Compartment();
  const look = new Compartment();
  const indent = new Compartment();
  let currentPath: string | null = null;
  // Last reloadToken applied per path; a mismatch means the doc must be replaced from tab.content.
  const tokens = new Map<string, number>();
  let applyingExternal = false;

  const makeTheme = (fontSize: number, fontFamily: string) =>
    baseTheme(fontSize, fontFamily, {
      '.cm-activeLine': { backgroundColor: 'var(--accent-soft)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
      '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
      '.cm-panels': { backgroundColor: 'var(--panel-2)', color: 'var(--text)' },
    });

  const lookExt = () => makeTheme(settings.value.editor.fontSize, settings.value.editor.fontFamily);
  const indentExt = () => [
    EditorState.tabSize.of(settings.value.editor.tabSize),
    indentUnit.of(' '.repeat(settings.value.editor.tabSize)),
  ];

  let cursorFrame = 0;
  function scheduleCursor(v: EditorView) {
    if (cursorFrame) return;
    cursorFrame = requestAnimationFrame(() => {
      cursorFrame = 0;
      const head = v.state.selection.main.head;
      const line = v.state.doc.lineAt(head);
      tabs.cursor = { line: line.number, col: head - line.from + 1 };
    });
  }

  function extensions(t: EditorTab): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      indent.of(indentExt()),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        { key: 'Mod-h', run: openSearchPanel, preventDefault: true },
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      ...highlightingExt,
      look.of(lookExt()),
      lang.of([]),
      EditorState.readOnly.of(t.readonly),
      EditorView.editable.of(!t.readonly),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applyingExternal && currentPath) onchange(currentPath, u.state.doc.toString());
        if (u.selectionSet || u.docChanged) {
          scheduleCursor(u.view);
          const r = u.state.selection.main;
          const txt = r.empty || r.to - r.from > 200 ? '' : u.state.sliceDoc(r.from, r.to);
          tabs.selectionHint = /[\r\n]/.test(txt) ? '' : txt;
        }
      }),
    ];
  }

  async function loadLanguage(path: string) {
    const support = await languageFor(path).catch(() => null);
    if (!support || !view) return;
    const effect = lang.reconfigure(support);
    if (currentPath === path) view.dispatch({ effects: effect });
    else {
      const st = states.get(path);
      if (st) states.set(path, st.update({ effects: effect }).state);
    }
  }

  function show(t: EditorTab) {
    if (!view) return;
    if (currentPath && isOpen(currentPath)) states.set(currentPath, view.state);
    for (const p of [...states.keys()]) if (!isOpen(p)) states.delete(p);
    let st = states.get(t.path);
    if (st && (t.reloadToken ?? 0) !== (tokens.get(t.path) ?? 0)) {
      st = undefined; // reloaded while hidden: rebuild from the new content
      states.delete(t.path);
    }
    tokens.set(t.path, t.reloadToken ?? 0);
    const fresh = !st;
    if (!st) st = EditorState.create({ doc: t.content, extensions: extensions(t) });
    currentPath = t.path;
    view.setState(st);
    scheduleCursor(view);
    if (fresh) void loadLanguage(t.path);
    view.focus();
  }

  onMount(() => {
    view = new EditorView({ parent: host });
    show(tab);
    const off = tabs.onRetarget((from, to) => {
      for (const p of [...states.keys()]) {
        const np = remapPath(p, from, to);
        if (np === null || np === p) continue;
        states.set(np, states.get(p)!);
        states.delete(p);
        if (tokens.has(p)) tokens.set(np, tokens.get(p)!);
        tokens.delete(p);
      }
      if (currentPath) currentPath = remapPath(currentPath, from, to) ?? currentPath;
    });
    return () => {
      off();
      if (cursorFrame) cancelAnimationFrame(cursorFrame);
      view?.destroy();
      view = undefined;
    };
  });

  // Live settings: reconfigure the visible state now; stored states keep undo history.
  $effect(() => {
    const e = settings.value.editor;
    void [e.fontSize, e.fontFamily, e.tabSize];
    if (!view) return;
    const effects = [look.reconfigure(lookExt()), indent.reconfigure(indentExt())];
    view.dispatch({ effects });
    for (const [p, st] of states) {
      if (p !== currentPath) states.set(p, st.update({ effects }).state);
    }
  });

  $effect(() => {
    const t = tab;
    if (t.path !== currentPath) show(t);
  });

  // External reload of the visible tab: replace the doc, keep clamped selection and scroll, no undo entry, not a user edit.
  $effect(() => {
    const t = tab;
    const tok = t.reloadToken ?? 0;
    if (!view || t.path !== currentPath || tok === (tokens.get(t.path) ?? 0)) return;
    tokens.set(t.path, tok);
    const cur = view.state.doc.toString();
    if (cur === t.content) return;
    const sel = clampSelection(view.state.selection.main, t.content.length);
    const top = view.scrollDOM.scrollTop;
    applyingExternal = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: t.content },
        selection: sel,
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      applyingExternal = false;
    }
    view.scrollDOM.scrollTop = top;
    requestAnimationFrame(() => {
      if (view) view.scrollDOM.scrollTop = top;
    });
  });

  // Reveal requests (find in project): select the range and scroll it into view, then clear the request.
  $effect(() => {
    const req = tab.revealRequest;
    if (!req || !view) return;
    if (tab.path !== currentPath) show(tab);
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(1, req.line), doc.lines));
    const from = Math.min(line.from + Math.max(0, req.col), line.to);
    const to = Math.min(from + Math.max(0, req.len), line.to);
    view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    view.focus();
    tab.revealRequest = undefined;
  });

  // Re-measure and focus when the (kept-mounted) editor is shown again.
  $effect(() => {
    if (visible && view) {
      view.requestMeasure();
      view.focus();
    }
  });
</script>

<div class="cm-host" bind:this={host}></div>

<style>
  .cm-host {
    height: 100%;
    min-height: 0;
  }
</style>
