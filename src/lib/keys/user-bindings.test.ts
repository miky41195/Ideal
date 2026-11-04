import { afterEach, describe, expect, it } from 'vitest';
import { parseKey, parseKeybindings } from './user-bindings';
import { DEFAULT_BINDINGS, routeKey, setBindings } from './router';

const ev = (code: string, ctrl = true, shift = true) => ({ code, ctrl, shift, alt: false });

describe('parseKey', () => {
  it('reads letters, digits, function keys and names', () => {
    expect(parseKey('Ctrl+Shift+E')).toEqual({ code: 'KeyE', ctrl: true, shift: true });
    expect(parseKey('ctrl+1')).toEqual({ code: 'Digit1', ctrl: true, shift: false });
    expect(parseKey('F5')).toEqual({ code: 'F5', ctrl: false, shift: false });
    expect(parseKey('Ctrl+`')).toEqual({ code: 'Backquote', ctrl: true, shift: false });
    expect(parseKey('Ctrl+Enter')).toEqual({ code: 'Enter', ctrl: true, shift: false });
  });

  it('refuses Alt, unknown keys and plain typing keys', () => {
    expect(parseKey('Alt+E')).toBeNull();
    expect(parseKey('Ctrl+Boh')).toBeNull();
    expect(parseKey('E')).toBeNull();
    expect(parseKey('Shift+E')).toBeNull();
  });
});

describe('parseKeybindings', () => {
  afterEach(() => setBindings(DEFAULT_BINDINGS));

  it('keeps the defaults with no file', () => {
    expect(parseKeybindings(null)).toEqual({ bindings: DEFAULT_BINDINGS, errors: [] });
    expect(parseKeybindings('  ')).toEqual({ bindings: DEFAULT_BINDINGS, errors: [] });
  });

  it('keeps the defaults and reports invalid JSON', () => {
    const r = parseKeybindings('{ rotto');
    expect(r.bindings).toBe(DEFAULT_BINDINGS);
    expect(r.errors).toHaveLength(1);
  });

  it('replaces the shortcut of a command, keeping where it applies', () => {
    const { bindings, errors } = parseKeybindings('[{"key":"Ctrl+Shift+M","command":"toggleMode"}]');
    expect(errors).toEqual([]);
    setBindings(bindings);
    expect(routeKey(ev('KeyM'), 'terminal')).toBe('toggleMode');
    expect(routeKey(ev('KeyE'), 'terminal')).toBeNull();
  });

  it('takes a key from the command that had it', () => {
    const { bindings } = parseKeybindings('[{"key":"Ctrl+Shift+E","command":"palette"}]');
    setBindings(bindings);
    expect(routeKey(ev('KeyE'), 'other')).toBe('palette');
  });

  it('allows two keys for one command', () => {
    const { bindings } = parseKeybindings('[{"key":"F6","command":"toggleMode"},{"key":"F7","command":"toggleMode"}]');
    setBindings(bindings);
    expect(routeKey(ev('F6', false, false), 'other')).toBe('toggleMode');
    expect(routeKey(ev('F7', false, false), 'other')).toBe('toggleMode');
  });

  it('removes a shortcut with a null key', () => {
    const { bindings } = parseKeybindings('[{"key":null,"command":"newClaudeTab"}]');
    setBindings(bindings);
    expect(routeKey(ev('KeyT'), 'other')).toBeNull();
  });

  it('skips bad entries, naming them, and applies the rest', () => {
    const { bindings, errors } = parseKeybindings('[{"key":"Ctrl+Shift+M","command":"nope"},{"key":"Boh","command":"palette"},{"key":"F6","command":"save"}]');
    expect(errors).toHaveLength(2);
    setBindings(bindings);
    expect(routeKey(ev('F6', false, false), 'editor')).toBe('save');
    expect(routeKey(ev('KeyP'), 'other')).toBe('palette');
  });
});
