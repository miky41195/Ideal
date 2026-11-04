import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/** Shared editor look (used by CodeEditor and DiffView). Colours are CSS variables, so a theme switch needs no reconfigure. */
export const baseTheme = (fontSize: number, fontFamily: string, extra: Record<string, Record<string, string>> = {}): Extension =>
  EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: `${fontSize}px` },
    // LSP hover docs and completion info can be huge (whole crate docs): keep them a scrollable box.
    '.cm-tooltip-hover, .cm-completionInfo': {
      maxHeight: '40vh',
      maxWidth: 'min(640px, 60vw)',
      overflow: 'auto',
      fontSize: '12.5px',
    },
    '.cm-scroller': { fontFamily, lineHeight: '1.5' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--accent-soft)',
    },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--text-dim)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--panel-2) 45%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: 'none' },
    '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      boxShadow: 'var(--shadow-pop)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--border)' },
    '.cm-textfield': { backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px' },
    '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text)' },
    '&.cm-focused': { outline: 'none' },
    ...extra,
  });

const style = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name)], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: 'var(--syn-func)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.definition(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--syn-func)' },
  { tag: t.heading, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

export const highlightingExt: Extension[] = [syntaxHighlighting(style, { fallback: true })];
