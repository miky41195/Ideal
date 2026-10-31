import { describe, it, expect, vi } from 'vitest';
import { dispatch, onCommand } from './commands';

describe('commands bus', () => {
  it('delivers to subscribers of that command only', () => {
    const a = vi.fn(), b = vi.fn();
    const ua = onCommand('save', a), ub = onCommand('palette', b);
    dispatch('save');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    ua(); ub();
  });
  it('unsubscribe stops delivery', () => {
    const a = vi.fn();
    const un = onCommand('save', a);
    un();
    dispatch('save');
    expect(a).not.toHaveBeenCalled();
  });
  it('dispatch without listeners is a no-op', () => {
    expect(() => dispatch('closeTab')).not.toThrow();
  });
});
