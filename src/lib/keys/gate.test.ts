import { describe, it, expect } from 'vitest';
import { isCommandAllowed, terminalShouldCapture } from './gate';

describe('isCommandAllowed', () => {
  it('blocks editor-only commands in claude mode', () => {
    for (const c of ['save', 'saveAll', 'closeTab', 'quickOpen'] as const) {
      expect(isCommandAllowed(c, 'claude')).toBe(false);
      expect(isCommandAllowed(c, 'editor')).toBe(true);
    }
  });
  it('quickOpenAny (Ctrl+Shift+O) works in claude mode, plain quickOpen (Ctrl+P) does not', () => {
    expect(isCommandAllowed('quickOpenAny', 'claude')).toBe(true);
    expect(isCommandAllowed('quickOpen', 'claude')).toBe(false);
  });
  it('allows global commands in both modes', () => {
    expect(isCommandAllowed('toggleMode', 'claude')).toBe(true);
    expect(isCommandAllowed('newClaudeTab', 'editor')).toBe(true);
  });
});

describe('terminalShouldCapture', () => {
  it('lets editor-only keys reach the PTY in claude mode', () => {
    expect(terminalShouldCapture('save', 'claude')).toBe(false);
    expect(terminalShouldCapture('save', 'editor')).toBe(true);
    expect(terminalShouldCapture('toggleMode', 'claude')).toBe(true);
    expect(terminalShouldCapture(null, 'editor')).toBe(false);
  });
});
