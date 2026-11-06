import { invoke, Channel } from '@tauri-apps/api/core';
import type { Transport } from '@codemirror/lsp-client';
import { canonicalizeUris } from './uri';

export interface LspStarted {
  serverId: number;
  reused: boolean;
}

/** Rejection payload of `lsp_start`. */
export interface LspStartError {
  missing: boolean;
  command: string;
  install: string;
  message: string;
}

export interface MessageSource {
  onmessage: (message: string) => void;
}

const EXIT_METHOD = '$/ideal/exit';

/** True when the default server of this language can be found on the PATH. */
export function serverAvailable(languageId: string): Promise<boolean> {
  return invoke<boolean>('lsp_available', { languageId });
}

/**
 * Transport over the Tauri channel. The Rust side appends a synthetic `$/ideal/exit`
 * notification when the server dies: it is reported through `onExit`, never forwarded.
 */
export function createTransport(
  serverId: number,
  source: MessageSource,
  onExit: (code: number | null, error?: LspStartError) => void,
): Transport {
  const handlers = new Set<(m: string) => void>();
  source.onmessage = (incoming: string) => {
    const raw = canonicalizeUris(incoming);
    if (raw.includes(EXIT_METHOD)) {
      try {
        const msg = JSON.parse(raw) as { method?: string; params?: { code?: number | null; error?: LspStartError } };
        if (msg.method === EXIT_METHOD) {
          onExit(msg.params?.code ?? null, msg.params?.error);
          return;
        }
      } catch {
        /* not JSON: forward as is */
      }
    }
    for (const h of [...handlers]) h(raw);
  };
  return {
    send: (message) => {
      void invoke('lsp_send', { serverId, message }).catch(() => onExit(null));
    },
    subscribe: (h) => void handlers.add(h),
    unsubscribe: (h) => void handlers.delete(h),
  };
}

/** Starts (or reuses) the server for `languageId` and returns its transport. Rejects with `LspStartError`. */
export async function startServer(
  languageId: string,
  root: string,
  onExit: (code: number | null, error?: LspStartError) => void,
): Promise<{ serverId: number; transport: Transport }> {
  const channel = new Channel<string>();
  const { serverId } = await invoke<LspStarted>('lsp_start', { languageId, root, onMessage: channel });
  return { serverId, transport: createTransport(serverId, channel, onExit) };
}

export const stopServer = (serverId: number): Promise<void> => invoke<void>('lsp_stop', { serverId });
