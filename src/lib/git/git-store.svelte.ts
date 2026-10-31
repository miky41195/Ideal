import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { gitStatus, gitWatch, type RepoStatus } from './git-client';

const msg = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));

export class GitState {
  status = $state<RepoStatus | null>(null);
  busy = $state<string | null>(null);
  error = $state<string | null>(null);
  path = '';
  #inFlight: Promise<void> | null = null;
  #queued: Promise<void> | null = null;

  /** At most one status call in flight plus one queued; extra callers share the queued one. */
  refresh(): Promise<void> {
    if (!this.path) return Promise.resolve();
    if (!this.#inFlight) {
      this.#inFlight = this.#fetch();
      return this.#inFlight;
    }
    if (!this.#queued) {
      this.#queued = this.#inFlight.then(() => {
        this.#queued = null;
        return this.refresh();
      });
    }
    return this.#queued;
  }

  async #fetch(): Promise<void> {
    try {
      this.status = await gitStatus(this.path);
    } catch (e) {
      this.error = msg(e);
    } finally {
      this.#inFlight = null;
    }
  }

  /** Runs a git action: sets busy/error, always refreshes afterwards. */
  async run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    this.busy = label;
    this.error = null;
    let ok = true;
    try {
      await fn();
    } catch (e) {
      this.error = msg(e);
      ok = false;
    } finally {
      this.busy = null;
    }
    await this.refresh();
    return ok;
  }
}

export const git = new GitState();

/** First refresh, start the backend watcher, follow git://changed and window focus. */
export async function initGit(projectPath: string): Promise<() => void> {
  git.path = projectPath;
  const offs: (() => void)[] = [];
  try {
    offs.push(await listen<string>('git://changed', () => void git.refresh()));
  } catch (e) {
    console.warn('git listen failed', e);
  }
  try {
    offs.push(
      await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) void git.refresh();
      }),
    );
  } catch (e) {
    console.warn('git focus listener failed', e);
  }
  await git.refresh();
  try {
    await gitWatch(projectPath);
  } catch (e) {
    console.warn('git watch failed', e);
  }
  return () => offs.forEach((f) => f());
}
