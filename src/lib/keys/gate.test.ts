import { describe, it, expect } from 'vitest';
import { isCommandAllowed } from './gate';

describe('isCommandAllowed', () => {
  it('blocks editor-only commands in claude mode', () => {
    for (const c of ['save', 'saveAll', 'closeTab', 'quickOpen'] as const) {
      expect(isCommandAllowed(c, 'claude')).toBe(false);
      expect(isCommandAllowed(c, 'editor')).toBe(true);
    }
  });
  it('allows global commands in both modes', () => {
    expect(isCommandAllowed('toggleMode', 'claude')).toBe(true);
    expect(isCommandAllowed('newClaudeTab', 'editor')).toBe(true);
  });
});
