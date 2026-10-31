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
  code: string; // physical key (KeyboardEvent.code)
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface Binding {
  code: string; // KeyboardEvent.code, layout independent
  ctrl: boolean;
  shift: boolean;
  focus: Focus[]; // focuses in which the binding is active
  command: Command;
}

const ANY: Focus[] = ['terminal', 'editor', 'other'];
const EDITOR: Focus[] = ['editor', 'other'];

export const DEFAULT_BINDINGS: Binding[] = [
  { code: 'KeyE', ctrl: true, shift: true, focus: ANY, command: 'toggleMode' },
  { code: 'KeyP', ctrl: true, shift: true, focus: ANY, command: 'palette' },
  { code: 'KeyO', ctrl: true, shift: true, focus: ANY, command: 'quickOpen' },
  { code: 'Backquote', ctrl: true, shift: true, focus: ANY, command: 'togglePanel' },
  { code: 'KeyT', ctrl: true, shift: true, focus: ANY, command: 'newClaudeTab' },
  { code: 'KeyS', ctrl: true, shift: true, focus: ANY, command: 'saveAll' },
  { code: 'KeyP', ctrl: true, shift: false, focus: EDITOR, command: 'quickOpen' },
  { code: 'KeyS', ctrl: true, shift: false, focus: EDITOR, command: 'save' },
  { code: 'KeyW', ctrl: true, shift: false, focus: EDITOR, command: 'closeTab' },
];

export function routeKey(
  ev: KeyEvent,
  focus: Focus,
  bindings: Binding[] = DEFAULT_BINDINGS,
): Command | null {
  if (ev.alt) return null;
  for (const b of bindings) {
    if (b.code === ev.code && b.ctrl === ev.ctrl && b.shift === ev.shift && b.focus.includes(focus)) {
      return b.command;
    }
  }
  return null;
}
