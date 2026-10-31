import { describe, it, expect } from 'vitest';
import { routeKey } from './router';

const k = (key: string, ctrl = true, shift = false, alt = false) => ({ key, ctrl, shift, alt });

describe('routeKey terminal focus', () => {
  it('passes plain Ctrl keys to the PTY', () => {
    expect(routeKey(k('e'), 'terminal')).toBeNull();
    expect(routeKey(k('p'), 'terminal')).toBeNull();
    expect(routeKey(k('r'), 'terminal')).toBeNull();
    expect(routeKey(k('s'), 'terminal')).toBeNull();
  });
  it('captures Ctrl+Shift combos', () => {
    expect(routeKey(k('E', true, true), 'terminal')).toBe('toggleMode');
    expect(routeKey(k('P', true, true), 'terminal')).toBe('palette');
    expect(routeKey(k('O', true, true), 'terminal')).toBe('quickOpen');
    expect(routeKey(k('`', true, true), 'terminal')).toBe('togglePanel');
    expect(routeKey(k('T', true, true), 'terminal')).toBe('newClaudeTab');
    expect(routeKey(k('S', true, true), 'terminal')).toBe('saveAll');
  });
});

describe('routeKey editor focus', () => {
  it('maps editor shortcuts', () => {
    expect(routeKey(k('E', true, true), 'editor')).toBe('toggleMode');
    expect(routeKey(k('p'), 'editor')).toBe('quickOpen');
    expect(routeKey(k('s'), 'editor')).toBe('save');
    expect(routeKey(k('w'), 'editor')).toBe('closeTab');
    expect(routeKey(k('T', true, true), 'editor')).toBe('newClaudeTab');
    expect(routeKey(k('S', true, true), 'editor')).toBe('saveAll');
  });
});

describe('routeKey other focus', () => {
  it('captures Ctrl+Shift combos in any focus', () => {
    expect(routeKey(k('T', true, true), 'other')).toBe('newClaudeTab');
    expect(routeKey(k('S', true, true), 'other')).toBe('saveAll');
  });
});
