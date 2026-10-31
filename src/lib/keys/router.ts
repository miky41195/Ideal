export type Focus = 'terminal' | 'editor' | 'other';
export type Command =
  | 'toggleMode'
  | 'palette'
  | 'quickOpen'
  | 'togglePanel'
  | 'newClaudeTab'
  | 'save'
  | 'saveAll'
  | 'closeTab';

export interface KeyEvent {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface Binding {
  key: string; // compared lowercase
  ctrl: boolean;
  shift: boolean;
  focus: Focus[]; // focuses in which the binding is active
  command: Command;
}

const ANY: Focus[] = ['terminal', 'editor', 'other'];
const EDITOR: Focus[] = ['editor', 'other'];

export const DEFAULT_BINDINGS: Binding[] = [
  { key: 'e', ctrl: true, shift: true, focus: ANY, command: 'toggleMode' },
  { key: 'p', ctrl: true, shift: true, focus: ANY, command: 'palette' },
  { key: 'o', ctrl: true, shift: true, focus: ANY, command: 'quickOpen' },
  { key: '`', ctrl: true, shift: true, focus: ANY, command: 'togglePanel' },
  { key: 't', ctrl: true, shift: true, focus: ANY, command: 'newClaudeTab' },
  { key: 's', ctrl: true, shift: true, focus: ANY, command: 'saveAll' },
  { key: 'p', ctrl: true, shift: false, focus: EDITOR, command: 'quickOpen' },
  { key: 's', ctrl: true, shift: false, focus: EDITOR, command: 'save' },
  { key: 'w', ctrl: true, shift: false, focus: EDITOR, command: 'closeTab' },
];

export function routeKey(
  ev: KeyEvent,
  focus: Focus,
  bindings: Binding[] = DEFAULT_BINDINGS,
): Command | null {
  if (ev.alt) return null;
  const key = ev.key.toLowerCase();
  for (const b of bindings) {
    if (b.key === key && b.ctrl === ev.ctrl && b.shift === ev.shift && b.focus.includes(focus)) {
      return b.command;
    }
  }
  return null;
}
