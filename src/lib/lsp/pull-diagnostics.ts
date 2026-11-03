import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { LSPPlugin, type LSPClientExtension } from '@codemirror/lsp-client';

/** LSP diagnostic as sent by the server (subset we use). */
export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
}

type Severity = Diagnostic['severity'];
const SEVERITY: Record<number, Severity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

/** Maps LSP diagnostics to CodeMirror ones; `toPos` converts an LSP position to a document offset. */
export function toCmDiagnostics(
  items: LspDiagnostic[],
  toPos: (p: { line: number; character: number }) => number,
): Diagnostic[] {
  return items.map((d) => {
    const from = toPos(d.range.start);
    const to = Math.max(from, toPos(d.range.end));
    return {
      from,
      to,
      severity: SEVERITY[d.severity ?? 1] ?? 'error',
      message: d.message,
      source: d.source,
    };
  });
}

/** Delays (ms) of the follow-up pulls after a file opens: servers answer empty until they finish loading. */
export const OPEN_PULLS_MS = [500, 3_000, 10_000, 30_000, 60_000];
/** Debounce after an edit before pulling again. */
export const EDIT_DEBOUNCE_MS = 600;

interface PullResult {
  kind?: string;
  items?: LspDiagnostic[];
}

/**
 * Pull diagnostics (`textDocument/diagnostic`, LSP 3.17). `@codemirror/lsp-client` 6.3 only
 * handles pushed diagnostics, but rust-analyzer reports its own diagnostics by pull only.
 * Pulls a bounded number of times after open and once per edit burst: no idle polling.
 */
export function pullDiagnostics(): LSPClientExtension {
  const plugin = ViewPlugin.fromClass(
    class {
      private timers: ReturnType<typeof setTimeout>[] = [];
      private editTimer: ReturnType<typeof setTimeout> | undefined;
      private seq = 0;
      constructor(readonly view: EditorView) {
        for (const ms of OPEN_PULLS_MS) this.timers.push(setTimeout(() => void this.pull(), ms));
      }
      update(u: ViewUpdate) {
        if (!u.docChanged) return;
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(() => void this.pull(), EDIT_DEBOUNCE_MS);
      }
      async pull() {
        const lsp = LSPPlugin.get(this.view);
        if (!lsp || !lsp.client.connected || !lsp.client.serverCapabilities?.diagnosticProvider) return;
        const mine = ++this.seq;
        lsp.client.sync();
        let res: PullResult | null;
        try {
          res = await lsp.client.request<unknown, PullResult | null>('textDocument/diagnostic', {
            textDocument: { uri: lsp.uri },
          });
        } catch {
          return; // server busy / cancelled: the next pull will retry
        }
        if (mine !== this.seq || !res || res.kind !== 'full' || !Array.isArray(res.items)) return;
        const cur = LSPPlugin.get(this.view);
        if (!cur) return;
        const diags = toCmDiagnostics(res.items, (p) => cur.unsyncedChanges.mapPos(cur.fromPosition(p, cur.syncedDoc)));
        this.view.dispatch(setDiagnostics(this.view.state, diags));
      }
      destroy() {
        this.timers.forEach(clearTimeout);
        clearTimeout(this.editTimer);
        this.seq++;
      }
    },
  );
  return {
    clientCapabilities: { textDocument: { diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false } } },
    editorExtension: plugin,
  };
}
