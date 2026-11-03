import { describe, it, expect } from 'vitest';
import { routeKey } from './router';

const ev = (code: string, key = '', ctrl = true, shift = false, alt = false) => ({ code, key, ctrl, shift, alt });
const cs = (code: string, key = '') => ev(code, key, true, true);

describe('routeKey terminal focus', () => {
  it('passes plain Ctrl keys to the PTY', () => {
    for (const c of ['KeyE', 'KeyP', 'KeyR', 'KeyS']) expect(routeKey(ev(c), 'terminal')).toBeNull();
  });
  it('captures Ctrl+Shift combos', () => {
    expect(routeKey(cs('KeyE', 'E'), 'terminal')).toBe('toggleMode');
    expect(routeKey(cs('KeyP', 'P'), 'terminal')).toBe('palette');
    expect(routeKey(cs('KeyO', 'O'), 'terminal')).toBe('quickOpenAny');
    expect(routeKey(cs('Backquote', '~'), 'terminal')).toBe('togglePanel');
    expect(routeKey(cs('KeyT', 'T'), 'terminal')).toBe('newClaudeTab');
    expect(routeKey(cs('KeyS', 'S'), 'terminal')).toBe('saveAll');
  });
  it('ignores key value when code matches (Italian layout)', () => {
    expect(routeKey(cs('Backquote', '|'), 'terminal')).toBe('togglePanel');
    expect(routeKey(cs('KeyE', 'whatever'), 'terminal')).toBe('toggleMode');
  });
  it('does not match on key alone', () => {
    expect(routeKey(cs('Digit1', 'E'), 'terminal')).toBeNull();
  });
  it('passes Alt/AltGr combos through', () => {
    expect(routeKey(ev('KeyE', 'e', true, true, true), 'terminal')).toBeNull();
    expect(routeKey(ev('Backquote', '', true, true, true), 'terminal')).toBeNull();
  });
});

describe('routeKey editor focus', () => {
  it('maps editor shortcuts', () => {
    expect(routeKey(cs('KeyE'), 'editor')).toBe('toggleMode');
    expect(routeKey(ev('KeyP'), 'editor')).toBe('quickOpen');
    expect(routeKey(ev('KeyS'), 'editor')).toBe('save');
    expect(routeKey(ev('KeyW'), 'editor')).toBe('closeTab');
    expect(routeKey(cs('KeyT'), 'editor')).toBe('newClaudeTab');
    expect(routeKey(cs('KeyS'), 'editor')).toBe('saveAll');
  });
});

describe('routeKey other focus', () => {
  it('captures Ctrl+Shift combos in any focus', () => {
    expect(routeKey(cs('KeyT'), 'other')).toBe('newClaudeTab');
    expect(routeKey(cs('KeyS'), 'other')).toBe('saveAll');
  });
});

describe('find in project', () => {
  it('Ctrl+Shift+F routes to searchProject in every focus', () => {
    for (const f of ['terminal', 'editor', 'other'] as const) expect(routeKey(cs('KeyF', 'F'), f)).toBe('searchProject');
  });
});
