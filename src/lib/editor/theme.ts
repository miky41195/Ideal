import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';

/** Shared editor look (used by CodeEditor and DiffView). */
export const baseTheme = (fontSize: number, fontFamily: string, extra: Record<string, Record<string, string>> = {}): Extension =>
  EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: `${fontSize}px` },
    '.cm-scroller': { fontFamily, lineHeight: '1.5' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--text-dim)', border: 'none' },
    '&.cm-focused': { outline: 'none' },
    ...extra,
  });

export const highlightingExt: Extension[] = [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), oneDark];
