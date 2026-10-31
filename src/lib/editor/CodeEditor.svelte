<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, Compartment, type Extension } from '@codemirror/state';
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
    syntaxHighlighting,
    defaultHighlightStyle,
    indentUnit,
  } from '@codemirror/language';
  import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { languageFor } from './languages';
  import { settings } from '../settings/settings.svelte';
  import { tabs, remapPath, type EditorTab } from './tabs.svelte';

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

  const makeTheme = (fontSize: number, fontFamily: string) =>
    EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: `${fontSize}px` },
    '.cm-scroller': { fontFamily, lineHeight: '1.5' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--text-dim)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'var(--accent-soft)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
    '.cm-panels': { backgroundColor: 'var(--panel-2)', color: 'var(--text)' },
    '&.cm-focused': { outline: 'none' },
  });

  const lookExt = () => makeTheme(settings.value.editor.fontSize, settings.value.editor.fontFamily);
  const indentExt = () => [
    EditorState.tabSize.of(settings.value.editor.tabSize),
    indentUnit.of(' '.repeat(settings.value.editor.tabSize)),
  ];

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
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
      oneDark,
      look.of(lookExt()),
      lang.of([]),
      EditorState.readOnly.of(t.readonly),
      EditorView.editable.of(!t.readonly),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && currentPath) onchange(currentPath, u.state.doc.toString());
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
    const fresh = !st;
    if (!st) st = EditorState.create({ doc: t.content, extensions: extensions(t) });
    currentPath = t.path;
    view.setState(st);
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
      }
      if (currentPath) currentPath = remapPath(currentPath, from, to) ?? currentPath;
    });
    return () => {
      off();
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
