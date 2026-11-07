import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

/** Saves what must survive the installer closing Ideal (hot-exit backups); set by the project window. */
let beforeInstall: () => Promise<void> = async () => {};
export const setBeforeInstall = (fn: () => Promise<void>): void => {
  beforeInstall = fn;
};

/** Other windows back up their unsaved buffers after 1 s of quiet (hot exit debounce). */
const OTHER_WINDOWS_MS = 1500;

export interface UpdaterDeps {
  check: () => Promise<Update | null>;
  wait: (ms: number) => Promise<void>;
}

const defaultDeps: UpdaterDeps = { check, wait: (ms) => new Promise((r) => setTimeout(r, ms)) };

export class Updater {
  available = $state<{ version: string; notes: string } | null>(null);
  /** "Più tardi": hidden until the next start. */
  later = $state(false);
  state = $state<'idle' | 'working' | 'error'>('idle');
  progress = $state<number | null>(null);
  error = $state<string | null>(null);
  #update: Update | null = null;

  constructor(private deps: UpdaterDeps = defaultDeps) {}

  async checkNow(): Promise<void> {
    try {
      const u = await this.deps.check();
      if (!u) return;
      this.#update = u;
      this.available = { version: u.version, notes: u.body ?? '' };
    } catch (e) {
      console.warn('update check failed', e); // offline or no release yet: stay quiet
    }
  }

  async install(): Promise<void> {
    const u = this.#update;
    if (!u || this.state === 'working') return;
    this.state = 'working';
    this.error = null;
    this.progress = null;
    try {
      let total = 0;
      let got = 0;
      await u.download((ev: DownloadEvent) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          got += ev.data.chunkLength;
          this.progress = total ? Math.round((got * 100) / total) : null;
        }
      });
    } catch (e) {
      this.fail(`Download non riuscito: ${String(e)}`);
      return;
    }
    // Backups right before the installer closes Ideal, so edits made during the download survive.
    try {
      await beforeInstall();
      await this.deps.wait(OTHER_WINDOWS_MS);
    } catch {
      this.fail('Alcune modifiche non salvate non entrano nel backup: salva i file e riprova');
      return;
    }
    try {
      await u.install(); // Windows: the installer closes Ideal and starts the new version
    } catch (e) {
      this.fail(`Installazione non riuscita: ${String(e)}`);
    }
  }

  private fail(message: string): void {
    this.state = 'error';
    this.error = message;
  }
}

export const updater = new Updater();
