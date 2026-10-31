import { describe, it, expect } from 'vitest';
import { EditorState, Compartment, Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';

describe('compartment reconfigure keeps undo history', () => {
  it('undo still restores the doc after reconfiguring font/tab', () => {
    const look = new Compartment();
    const indent = new Compartment();
    const mk = (size: number, tab: number) => [
      look.of(EditorView.theme({ '&': { fontSize: `${size}px` } })),
      indent.of([EditorState.tabSize.of(tab), indentUnit.of(' '.repeat(tab))]),
    ];
    const state = EditorState.create({ doc: 'abc', extensions: [history(), mk(14, 2)] });
    // Headless: drive a plain state through the same commands the view uses.
    let cur = state;
    const view = {
      get state() {
        return cur;
      },
      dispatch: (spec: TransactionSpec | Transaction) => {
        cur = (spec instanceof Transaction ? spec : cur.update(spec)).state;
      },
    };
    view.dispatch({ changes: { from: 3, insert: 'def' }, userEvent: 'input.type' });
    expect(view.state.doc.toString()).toBe('abcdef');
    view.dispatch({
      effects: [
        look.reconfigure(EditorView.theme({ '&': { fontSize: '20px' } })),
        indent.reconfigure([EditorState.tabSize.of(4), indentUnit.of('    ')]),
      ],
    });
    expect(view.state.tabSize).toBe(4);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('abc');
  });
});
