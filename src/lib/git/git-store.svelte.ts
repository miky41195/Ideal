import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { gitStatus, gitWatch, gitToplevel, type RepoStatus } from './git-client';

const msg = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));

export class GitState {
  status = $state<RepoStatus | null>(null);
  busy = $state<string | null>(null);
  /** Error of the last git action (run); kept until dismissed or the next action. */
  error = $state<string | null>(null);
  /** Error of the last status refresh; cleared by the next successful refresh. */
  statusError = $state<string | null>(null);
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
      this.statusError = null;
    } catch (e) {
      this.statusError = msg(e);
    } finally {
      this.#inFlight = null;
    }
  }

  /** Runs a git action: sets busy/error, always refreshes afterwards. */
  async run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    if (this.busy) return false;
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

const changedListeners = new Set<() => void>();
/** Subscribe to git://changed (fired by the backend watcher); returns an unsubscribe fn. */
export function onGitChanged(cb: () => void): () => void {
  changedListeners.add(cb);
  return () => changedListeners.delete(cb);
}

/** First refresh, start the backend watcher, follow git://changed and window focus. */
export async function initGit(projectPath: string): Promise<() => void> {
  // Work at the repo root: status paths and diffs are root-relative even if the project is a subfolder.
  git.path = (await gitToplevel(projectPath).catch(() => null)) ?? projectPath;
  const offs: (() => void)[] = [];
  try {
    offs.push(
      await getCurrentWebviewWindow().listen<string>('git://changed', (e) => {
        if (typeof e.payload === 'string' && e.payload !== git.path) return;
        void git.refresh();
        changedListeners.forEach((f) => {
          try {
            f();
          } catch (e) {
            console.warn('git changed listener failed', e);
          }
        });
      }),
    );
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
    await gitWatch(git.path);
  } catch (e) {
    console.warn('git watch failed', e);
  }
  return () => offs.forEach((f) => f());
}
