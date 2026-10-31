import { invoke, Channel } from '@tauri-apps/api/core';

export type PtyKind =
  | { type: 'Claude'; resume: string | null; continue_last: boolean }
  | { type: 'Shell'; program: string | null };

interface ExitPayload {
  code: number | null;
}

export function spawnPty(
  kind: PtyKind,
  cwd: string,
  cols: number,
  rows: number,
  onData: (s: string) => void,
  onExit: (code: number | null) => void,
): Promise<number> {
  const dataCh = new Channel<string>();
  dataCh.onmessage = onData;
  const exitCh = new Channel<ExitPayload>();
  exitCh.onmessage = (p) => onExit(p.code);
  return invoke<number>('pty_spawn', { kind, cwd, cols, rows, onData: dataCh, onExit: exitCh });
}

export function writePty(id: number, data: string): Promise<void> {
  return invoke('pty_write', { id, data });
}

export function resizePty(id: number, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { id, cols, rows });
}

export function killPty(id: number): Promise<void> {
  return invoke('pty_kill', { id });
}
