import { currentBindings, type Command } from '../keys/router';
import { fuzzyScore } from '../search/fuzzy';

export interface PaletteCommand {
  id: string;
  label: string;
  run: () => void | Promise<void>;
  when?: () => boolean;
  /** Shortcut hint, e.g. "Ctrl+Shift+E". */
  keys?: string;
}

const registry = new Map<string, PaletteCommand>();

/** Registers commands (same id replaces); returns an unregister function. */
export function registerCommands(cmds: PaletteCommand[]): () => void {
  for (const c of cmds) registry.set(c.id, c);
  return () => {
    for (const c of cmds) if (registry.get(c.id) === c) registry.delete(c.id);
  };
}

export function listCommands(): PaletteCommand[] {
  return [...registry.values()].filter((c) => !c.when || c.when()).sort((a, b) => a.label.localeCompare(b.label, 'it'));
}

export function filterCommands(query: string, cmds: PaletteCommand[]): PaletteCommand[] {
  if (!query.trim()) return cmds;
  const scored: { c: PaletteCommand; s: number }[] = [];
  for (const c of cmds) {
    const s = fuzzyScore(query, c.label);
    if (s !== null) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.c);
}

const KEY_NAMES: Record<string, string> = { Backquote: '`' };

/** Shortcut text of the first binding for `command`, e.g. "Ctrl+Shift+E". */
export function formatBinding(command: Command): string | undefined {
  const b = currentBindings().find((x) => x.command === command);
  if (!b) return undefined;
  const key = KEY_NAMES[b.code] ?? b.code.replace(/^Key/, '').replace(/^Digit/, '');
  return [b.ctrl ? 'Ctrl' : '', b.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}
