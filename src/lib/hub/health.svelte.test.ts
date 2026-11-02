// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./hub-client', () => ({ memHealth: vi.fn(), memStartWorker: vi.fn(), pluginsStatus: vi.fn() }));
vi.mock('../settings/settings.svelte', () => ({ settings: { value: { claudeMem: { port: 37777 } } } }));

import * as c from './hub-client';
import { HealthState } from './health.svelte';

const m = vi.mocked(c);
const MIN5 = 5 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  m.pluginsStatus.mockResolvedValue({ claudeMem: true, caveman: true });
  m.memHealth.mockResolvedValue(true);
  m.memStartWorker.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('HealthState', () => {
  it('ensureWorker: down -> starting -> up at 3s', async () => {
    const h = new HealthState();
    h.mem = 'down';
    m.memHealth.mockResolvedValue(false);
    await h.ensureWorker();
    expect(h.mem).toBe('starting');
    m.memHealth.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.mem).toBe('up');
  });

  it('ensureWorker: still down after 3s and 8s -> down', async () => {
    const h = new HealthState();
    h.mem = 'down';
    m.memHealth.mockResolvedValue(false);
    await h.ensureWorker();
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.mem).toBe('starting');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.mem).toBe('down');
    expect(m.memHealth).toHaveBeenCalledTimes(2);
  });

  it('ensureWorker does not spawn twice concurrently', async () => {
    const h = new HealthState();
    h.mem = 'down';
    await Promise.all([h.ensureWorker(), h.ensureWorker()]);
    await h.ensureWorker();
    expect(m.memStartWorker).toHaveBeenCalledTimes(1);
  });

  it('spawn failure -> down', async () => {
    const h = new HealthState();
    m.memStartWorker.mockRejectedValue('x');
    await h.ensureWorker();
    expect(h.mem).toBe('down');
  });

  it('auto-start backs off 10 min after a failure; manual start still works', async () => {
    const h = new HealthState();
    h.mem = 'down';
    m.memStartWorker.mockRejectedValue('x');
    await h.autoStart();
    await h.autoStart();
    expect(m.memStartWorker).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    await h.autoStart();
    expect(m.memStartWorker).toHaveBeenCalledTimes(1);
    await h.ensureWorker();
    expect(m.memStartWorker).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    await h.autoStart();
    expect(m.memStartWorker).toHaveBeenCalledTimes(3);
  });

  it('auto-start backs off also when the worker never comes up', async () => {
    const h = new HealthState();
    h.mem = 'down';
    m.memHealth.mockResolvedValue(false);
    await h.autoStart();
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.mem).toBe('down');
    await h.autoStart();
    expect(m.memStartWorker).toHaveBeenCalledTimes(1);
  });

  it('check isolates plugin error from mem status', async () => {
    const h = new HealthState();
    m.pluginsStatus.mockRejectedValue('no settings');
    await h.check();
    expect(h.plugins).toBeNull();
    expect(h.mem).toBe('up');
    m.pluginsStatus.mockResolvedValue({ claudeMem: false, caveman: true });
    m.memHealth.mockRejectedValue('down');
    await h.check();
    expect(h.plugins).toEqual({ claudeMem: false, caveman: true });
    expect(h.mem).toBe('down');
  });

  it('interval runs only while focused; blur clears; teardown clears', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const h = new HealthState();
    const off = h.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.memHealth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MIN5);
    expect(m.memHealth).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(MIN5 * 3);
    expect(m.memHealth).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(m.memHealth).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(MIN5);
    expect(m.memHealth).toHaveBeenCalledTimes(4);
    off();
    await vi.advanceTimersByTimeAsync(MIN5 * 2);
    expect(m.memHealth).toHaveBeenCalledTimes(4);
  });

  it('tick auto-starts worker when plugin on and mem down', async () => {
    const h = new HealthState();
    m.memHealth.mockResolvedValue(false);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const off = h.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.memStartWorker).toHaveBeenCalledTimes(1);
    off();
  });
});
