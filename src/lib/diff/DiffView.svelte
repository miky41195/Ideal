<script lang="ts">
  import { EditorState, type Extension } from '@codemirror/state';
  import { EditorView, lineNumbers } from '@codemirror/view';
  import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { MergeView } from '@codemirror/merge';
  import { languageFor } from '../editor/languages';
  import { settings } from '../settings/settings.svelte';
  import type { DiffData } from '../editor/tabs.svelte';

  let { diff }: { diff: DiffData } = $props();

  let host: HTMLDivElement | undefined = $state();

  const theme = (fontSize: number, fontFamily: string) =>
    EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: `${fontSize}px` },
      '.cm-scroller': { fontFamily, lineHeight: '1.5' },
      '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--text-dim)', border: 'none' },
      '&.cm-focused': { outline: 'none' },
    });

  $effect(() => {
    const d = diff;
    const e = settings.value.editor;
    const fontSize = e.fontSize;
    const fontFamily = e.fontFamily;
    const el = host;
    if (!el || d.binary) return;
    let cancelled = false;
    let mv: MergeView | undefined;
    void (async () => {
      const support = await languageFor(d.langPath).catch(() => null);
      if (cancelled) return;
      const base: Extension[] = [
        lineNumbers(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        theme(fontSize, fontFamily),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        ...(support ? [support] : []),
      ];
      mv = new MergeView({
        parent: el,
        a: { doc: d.old, extensions: base },
        b: { doc: d.new, extensions: base },
        highlightChanges: true,
        gutter: true,
      });
    })();
    return () => {
      cancelled = true;
      mv?.destroy();
    };
  });
</script>

{#if diff.binary}
  <div class="bin">File binario — diff non disponibile</div>
{:else}
  <div class="diff" bind:this={host}></div>
{/if}

<style>
  .diff {
    height: 100%;
    overflow: auto;
  }
  .diff :global(.cm-mergeView) {
    min-height: 100%;
  }
  .bin {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--text-dim);
  }
</style>
