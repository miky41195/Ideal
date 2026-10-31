import { describe, it, expect, vi, afterEach } from 'vitest';
import { toasts, showToast } from './toast.svelte';

afterEach(() => vi.useRealTimers());

describe('toast', () => {
  it('auto-hides after the timeout', () => {
    vi.useFakeTimers();
    showToast('ciao', 6000);
    expect(toasts.items.map((t) => t.text)).toEqual(['ciao']);
    vi.advanceTimersByTime(5999);
    expect(toasts.items).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(toasts.items).toHaveLength(0);
  });
});
