import type { Command } from './router';

const EDITOR_ONLY: Command[] = ['save', 'saveAll', 'closeTab', 'quickOpen'];

/** Editor-only commands are ignored (not swallowed) while in Claude mode. */
export function isCommandAllowed(cmd: Command, mode: 'claude' | 'editor'): boolean {
  return mode === 'editor' || !EDITOR_ONLY.includes(cmd);
}
