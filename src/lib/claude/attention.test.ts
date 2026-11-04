import { describe, expect, it } from 'vitest';
import { AttentionTracker } from './attention';
import { contextLevel } from './tokens';

describe('AttentionTracker', () => {
  it('fires once when output stops after real work', () => {
    const a = new AttentionTracker();
    a.onSubmit(0);
    a.onOutput(1000);
    a.onOutput(6000);
    expect(a.tick(8000)).toBe(false);
    expect(a.tick(10_100)).toBe(true);
    expect(a.tick(20_000)).toBe(false);
  });

  it('never fires without a submitted message: startup, resize and typing stay quiet', () => {
    const a = new AttentionTracker();
    a.onOutput(0);
    a.onOutput(9000);
    expect(a.tick(30_000)).toBe(false);
  });

  it('stays quiet for a quick reply', () => {
    const a = new AttentionTracker();
    a.onSubmit(0);
    a.onOutput(1500);
    expect(a.tick(6000)).toBe(false);
    expect(a.tick(30_000)).toBe(false);
  });

  it('waits while output keeps coming', () => {
    const a = new AttentionTracker();
    a.onSubmit(0);
    for (let t = 1000; t <= 60_000; t += 1000) {
      a.onOutput(t);
      expect(a.tick(t + 500)).toBe(false);
    }
  });

  it('does not fire before any output arrives', () => {
    const a = new AttentionTracker();
    a.onSubmit(0);
    expect(a.tick(30_000)).toBe(false);
  });

  it('arms again on the next message', () => {
    const a = new AttentionTracker();
    a.onSubmit(0);
    a.onOutput(6000);
    expect(a.tick(11_000)).toBe(true);
    a.onSubmit(20_000);
    a.onOutput(26_000);
    expect(a.tick(31_000)).toBe(true);
  });

  it('reports whether it needs ticking', () => {
    const a = new AttentionTracker();
    expect(a.armed).toBe(false);
    a.onSubmit(0);
    expect(a.armed).toBe(true);
  });
});

describe('contextLevel', () => {
  it('rises at the threshold and at twice the threshold', () => {
    expect(contextLevel(null, 200_000)).toBe('ok');
    expect(contextLevel(199_999, 200_000)).toBe('ok');
    expect(contextLevel(200_000, 200_000)).toBe('warn');
    expect(contextLevel(400_000, 200_000)).toBe('high');
  });

  it('is off when the threshold is zero', () => {
    expect(contextLevel(900_000, 0)).toBe('ok');
  });
});
