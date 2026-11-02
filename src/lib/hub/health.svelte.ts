import { settings } from '../settings/settings.svelte';
import * as c from './hub-client';

export type MemState = 'unknown' | 'up' | 'down' | 'starting';
const KEEP_ALIVE_MS = 5 * 60 * 1000;
const AUTO_BACKOFF_MS = 10 * 60 * 1000;

export class HealthState {
  plugins = $state<c.PluginStatus | null>(null);
  mem = $state<MemState>('unknown');

  private inflight = false;
  private noAutoUntil = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  private get port(): number {
    return settings.value.claudeMem.port;
  }

  /** Plugin and worker state are independent: one failing never masks the other. */
  async check(): Promise<void> {
    const [p, m] = await Promise.allSettled([c.pluginsStatus(), c.memHealth(this.port)]);
    if (p.status === 'fulfilled') this.plugins = p.value;
    if (m.status === 'fulfilled' && m.value) this.mem = 'up';
    else if (this.mem !== 'starting') this.mem = 'down';
  }

  private async probe(): Promise<boolean> {
    try {
      return await c.memHealth(this.port);
    } catch {
      return false;
    }
  }

  /** Spawns the worker once at a time; re-checks after 3 s and 8 s, then gives up as 'down'. */
  async ensureWorker(): Promise<void> {
    if (this.inflight || this.mem === 'up') return;
    this.inflight = true;
    this.mem = 'starting';
    try {
      await c.memStartWorker();
    } catch {
      this.inflight = false;
      this.mem = 'down';
      this.noAutoUntil = Date.now() + AUTO_BACKOFF_MS;
      return;
    }
    const finish = (up: boolean) => {
      this.retry = null;
      this.inflight = false;
      this.mem = up ? 'up' : 'down';
      if (!up) this.noAutoUntil = Date.now() + AUTO_BACKOFF_MS;
    };
    const second = async () => finish(await this.probe());
    const first = async () => {
      if (await this.probe()) return finish(true);
      this.retry = setTimeout(() => void second(), 5000);
    };
    this.retry = setTimeout(() => void first(), 3000);
  }

  /** Automatic start: skipped for 10 min after a failed attempt (manual ensureWorker is never throttled). */
  async autoStart(): Promise<void> {
    if (Date.now() < this.noAutoUntil) return;
    await this.ensureWorker();
  }

  private async tick(): Promise<void> {
    await this.check();
    if (this.mem === 'down' && this.plugins?.claudeMem) await this.autoStart();
  }

  private startInterval(): void {
    this.stopInterval();
    this.interval = setInterval(() => void this.tick(), KEEP_ALIVE_MS);
  }
  private stopInterval(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Check now (project open), on window focus, and every 5 min only while focused. Returns teardown. */
  init(): () => void {
    const onFocus = () => {
      void this.tick();
      this.startInterval();
    };
    const onBlur = () => this.stopInterval();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    void this.tick();
    if (document.hasFocus()) this.startInterval();
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      this.stopInterval();
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      this.inflight = false;
    };
  }
}

export const health = new HealthState();
