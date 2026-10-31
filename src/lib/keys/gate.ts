import type { Command } from './router';

const EDITOR_ONLY: Command[] = ['save', 'saveAll', 'closeTab', 'quickOpen'];

/** Editor-only commands are ignored (not swallowed) while in Claude mode. */
export function isCommandAllowed(cmd: Command, mode: 'claude' | 'editor'): boolean {
  return mode === 'editor' || !EDITOR_ONLY.includes(cmd);
}

/** The terminal swallows a Ctrl+Shift shortcut only if it is allowed in the current mode; otherwise the key goes to the PTY. */
export const terminalShouldCapture = (cmd: Command | null, mode: 'claude' | 'editor'): boolean =>
  cmd !== null && isCommandAllowed(cmd, mode);
