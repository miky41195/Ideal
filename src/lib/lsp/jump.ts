import { Text } from '@codemirror/state';
import { uriToPath } from './uri';

export interface FileOpener {
  /** Opens the file and returns its text, or null if it cannot be opened. */
  read(path: string): Promise<string | null>;
  /** Shows the file at a 1-based line and 0-based column. */
  reveal(path: string, line: number, col: number): void;
}

let opener: FileOpener | null = null;

/** Registered by the tabs store: the LSP layer sits below it and cannot import it. */
export function setFileOpener(o: FileOpener | null): void {
  opener = o;
}

/**
 * Stands in for an EditorView of another file. Ideal has one editor that swaps documents, while
 * the LSP client wants a view of the target: it only reads `state.doc` and dispatches a selection.
 */
export async function displayTarget(uri: string) {
  if (!opener) return null;
  const o = opener;
  const path = uriToPath(uri);
  const text = await o.read(path);
  if (text === null) return null;
  const doc = Text.of(text.split(/\r?\n/));
  return {
    state: { doc },
    focus() {},
    dispatch(tr: { selection?: { anchor: number } }) {
      const at = tr.selection?.anchor;
      if (at === undefined) return;
      const line = doc.lineAt(at);
      o.reveal(path, line.number, at - line.from);
    },
  };
}
