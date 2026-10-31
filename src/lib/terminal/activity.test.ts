import { describe, it, expect, vi, afterEach } from 'vitest';
import { debounce, notifyTerminalActivity, onTerminalActivity } from './activity';

afterEach(() => vi.useRealTimers());

describe('terminal activity', () => {
  it('notifies subscribers until unsubscribed', () => {
    const cb = vi.fn();
    const off = onTerminalActivity(cb);
    notifyTerminalActivity();
    off();
    notifyTerminalActivity();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('debounce fires once after the idle period', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1500);
    d();
    vi.advanceTimersByTime(1000);
    d();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('debounce cancel drops the pending run', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1500);
    d();
    d.cancel();
    vi.advanceTimersByTime(3000);
    expect(fn).not.toHaveBeenCalled();
  });
});
