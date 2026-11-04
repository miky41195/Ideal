import { ALL_COMMANDS, DEFAULT_BINDINGS, type Binding, type Command, type Focus } from './router';

const NAMED: Record<string, string> = {
  '`': 'Backquote',
  enter: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
};

/** "Ctrl+Shift+E" to a physical key. Without Ctrl only F keys are accepted, so typing never gets swallowed. */
export function parseKey(text: string): { code: string; ctrl: boolean; shift: boolean } | null {
  const parts = text.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const mods = parts.map((p) => p.toLowerCase());
  if (mods.some((m) => m !== 'ctrl' && m !== 'shift')) return null;
  const ctrl = mods.includes('ctrl');
  const shift = mods.includes('shift');
  let code: string | undefined;
  if (/^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`;
  else if (/^[0-9]$/.test(key)) code = `Digit${key}`;
  else if (/^f([1-9]|1[0-2])$/i.test(key)) code = key.toUpperCase();
  else code = NAMED[key.toLowerCase()];
  if (!code || (!ctrl && !code.startsWith('F'))) return null;
  return { code, ctrl, shift };
}

const ANY: Focus[] = ['terminal', 'editor', 'other'];

/** Applies keybindings.json over the defaults; a bad entry is reported and skipped, never fatal. */
export function parseKeybindings(text: string | null): { bindings: Binding[]; errors: string[] } {
  if (!text?.trim()) return { bindings: DEFAULT_BINDINGS, errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { bindings: DEFAULT_BINDINGS, errors: ['keybindings.json non valido: uso le scorciatoie predefinite'] };
  }
  if (!Array.isArray(raw)) return { bindings: DEFAULT_BINDINGS, errors: ['keybindings.json deve essere una lista'] };

  const errors: string[] = [];
  let out = [...DEFAULT_BINDINGS];
  const touched = new Set<Command>();
  for (const e of raw as { key?: unknown; command?: unknown }[]) {
    const command = e?.command as Command;
    if (!ALL_COMMANDS.includes(command)) {
      errors.push(`Comando sconosciuto: ${String(e?.command)}`);
      continue;
    }
    const focus = DEFAULT_BINDINGS.find((b) => b.command === command)?.focus ?? ANY;
    if (!touched.has(command)) {
      touched.add(command);
      out = out.filter((b) => b.command !== command);
    }
    if (e.key === null) continue;
    const k = typeof e.key === 'string' ? parseKey(e.key) : null;
    if (!k) {
      errors.push(`Scorciatoia non valida: ${String(e.key)}`);
      out = [...DEFAULT_BINDINGS.filter((b) => b.command === command), ...out];
      continue;
    }
    // Same key on another command: the user's choice wins.
    out = out.filter((b) => !(b.code === k.code && b.ctrl === k.ctrl && b.shift === k.shift));
    out.push({ ...k, focus, command });
  }
  return { bindings: out, errors };
}
