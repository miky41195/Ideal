import type { Extension } from '@codemirror/state';
import { LSPClient, languageServerExtensions, type Transport } from '@codemirror/lsp-client';
import type { EditorView } from '@codemirror/view';
import { displayTarget } from './jump';
import DOMPurify from 'dompurify';
import { showToast } from '../ui/toast.svelte';
import { languageIdFor, serverKeyFor } from './lang';
import { pathToUri } from './uri';
import { pullDiagnostics } from './pull-diagnostics';
import { startServer, stopServer, type LspStartError } from './lsp-client';

export const IDLE_MS = 300_000;

export type LspState = 'starting' | 'ready' | 'missing' | 'error';

/** The slice of `LSPClient` the manager uses (lets tests inject a fake). */
export interface ClientLike {
  initializing: Promise<unknown>;
  connect(transport: Transport): unknown;
  disconnect(): void;
  plugin(uri: string, languageId: string): Extension;
  sync?(): void;
  notification?(method: string, params: unknown): void;
}

export interface LspDeps {
  start(languageId: string, root: string, onExit: (code: number | null, error?: LspStartError) => void): Promise<{ serverId: number; transport: Transport }>;
  stop(serverId: number): Promise<void>;
  createClient(rootUri: string): ClientLike;
  notify(message: string): void;
}

const defaultDeps: LspDeps = {
  start: startServer,
  stop: stopServer,
  createClient: (rootUri) => {
    const client = new LSPClient({
      rootUri,
      sanitizeHTML: (h) => DOMPurify.sanitize(h),
      extensions: [...languageServerExtensions(), pullDiagnostics()],
    });
    // Stock displayFile only knows files already open in this client.
    client.workspace.displayFile = (uri) => displayTarget(uri) as unknown as Promise<EditorView | null>;
    return client;
  },
  notify: (m) => showToast(m),
};

interface Entry {
  key: string;
  ready: Promise<{ client: ClientLike } | null>;
  client?: ClientLike;
  serverId?: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class LspManager {
  state = $state<Record<string, LspState>>({});
  private entries = new Map<string, Entry>();
  private refs = new Map<string, number>();
  private noticed = new Set<string>();
  private hints = new Map<string, { languageId: string; install: string }>();
  /** Bumped by `retry` so open editors re-request their extension. */
  tick = $state(0);

  constructor(private deps: LspDeps = defaultDeps) {}

  /** CodeMirror extension wiring `path` to its language server, or null (unknown language, missing/failed server). */
  async extensionFor(path: string, root: string): Promise<Extension | null> {
    const languageId = languageIdFor(path);
    const key = languageId ? serverKeyFor(languageId) : null;
    if (!languageId || !key) return null;
    const st = this.state[key];
    if (st === 'missing' || st === 'error') return null;
    let entry = this.entries.get(key);
    if (!entry) entry = this.begin(key, languageId, root);
    const r = await entry.ready;
    if (!r) return null;
    return r.client.plugin(pathToUri(path), languageId);
  }

  private begin(key: string, languageId: string, root: string): Entry {
    const entry: Entry = { key, ready: Promise.resolve(null) };
    this.entries.set(key, entry);
    this.state[key] = 'starting';
    entry.ready = (async () => {
      try {
        const { serverId, transport } = await this.deps.start(languageId, root, (_code, error) => this.crashed(entry, languageId, error));
        entry.serverId = serverId;
        if (this.entries.get(key) !== entry) {
          // stopped (stopAll / idle) while starting
          void this.deps.stop(serverId).catch(() => {});
          return null;
        }
        const client = this.deps.createClient(pathToUri(root));
        entry.client = client;
        client.connect(transport);
        await client.initializing;
        if (this.entries.get(key) !== entry) return null;
        this.state[key] = 'ready';
        return { client };
      } catch (e) {
        if (this.entries.get(key) === entry) this.fail(entry, e, languageId);
        return null;
      }
    })();
    return entry;
  }

  private fail(entry: Entry, e: unknown, languageId: string): void {
    const err = (e ?? {}) as Partial<LspStartError>;
    entry.client?.disconnect();
    if (entry.serverId !== undefined) void this.deps.stop(entry.serverId).catch(() => {});
    if (err.missing) {
      this.state[entry.key] = 'missing';
      this.hints.set(entry.key, { languageId, install: String(err.install ?? '') });
      if (!this.noticed.has(entry.key)) {
        this.noticed.add(entry.key);
        this.deps.notify(`Server ${languageId} non installato — installa con: ${err.install}`);
      }
    } else {
      this.state[entry.key] = 'error';
      console.warn(`LSP ${entry.key} non avviato`, e);
    }
    this.clearTimer(entry);
    // The failed entry stays out of the map; the sticky state blocks any retry.
    this.entries.delete(entry.key);
  }

  private crashed(entry: Entry, languageId: string, error?: LspStartError): void {
    if (this.entries.get(entry.key) !== entry) return;
    // Died while starting (e.g. a launcher stub saying the server isn't installed): treat as a start failure.
    if (this.state[entry.key] === 'starting' && error) {
      this.fail(entry, error, languageId);
      return;
    }
    entry.client?.disconnect();
    this.clearTimer(entry);
    this.entries.delete(entry.key);
    this.state[entry.key] = 'error';
  }

  /** Clears a `missing`/`error` state so the next `extensionFor` starts the server again. */
  retry(key: string): void {
    const st = this.state[key];
    if (st !== 'missing' && st !== 'error') return;
    if (st === 'missing') this.noticed.delete(key);
    delete this.state[key];
    this.tick++;
  }

  /** Shows the install notice again (status bar click on "non installato"). */
  showMissing(key: string): void {
    const h = this.hints.get(key);
    if (h) this.deps.notify(`Server ${h.languageId} non installato — installa con: ${h.install}`);
  }

  /** A file was saved to disk: tell its server (rust-analyzer runs `cargo check` on save). */
  saved(path: string): void {
    const key = this.keyOf(path);
    const client = key ? this.entries.get(key)?.client : undefined;
    if (!client || this.state[key!] !== 'ready') return;
    try {
      client.sync?.();
      client.notification?.('textDocument/didSave', { textDocument: { uri: pathToUri(path) } });
    } catch {
      /* server gone: the exit notice handles state */
    }
  }

  /** A file of this language was opened in a tab. */
  opened(path: string): void {
    const key = this.keyOf(path);
    if (!key) return;
    this.refs.set(key, (this.refs.get(key) ?? 0) + 1);
    const entry = this.entries.get(key);
    if (entry) this.clearTimer(entry);
  }

  /** A file of this language was closed; the last one starts the idle countdown. */
  closed(path: string): void {
    const key = this.keyOf(path);
    if (!key) return;
    const n = Math.max(0, (this.refs.get(key) ?? 0) - 1);
    this.refs.set(key, n);
    const entry = this.entries.get(key);
    if (n === 0 && entry) {
      this.clearTimer(entry);
      entry.timer = setTimeout(() => void this.stop(entry), IDLE_MS);
    }
  }

  private keyOf(path: string): string | null {
    const id = languageIdFor(path);
    return id ? serverKeyFor(id) : null;
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private async stop(entry: Entry): Promise<void> {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    this.clearTimer(entry);
    delete this.state[entry.key];
    entry.client?.disconnect();
    // If the start is still in flight, begin() stops the server as soon as it knows the id.
    if (entry.serverId !== undefined) await this.deps.stop(entry.serverId).catch(() => {});
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => this.stop(e)));
    this.refs.clear();
  }
}

export const lsp = new LspManager();
