import { invoke } from '@tauri-apps/api/core';
import { remoteState } from './tokens';

/** Readout for the Claude tab on screen. */
class ClaudeUsage {
  /** Tokens Claude re-reads on the next send, from the session's last real reply. Null before the first reply. */
  context = $state<number | null>(null);
  /** Rough size of what is typed in the input box. */
  draft = $state(0);
  /** Tab the readout describes. */
  tab = $state<string | null>(null);
  /** What each tab's Remote Control panel last said. */
  screens = $state<Record<string, boolean>>({});
  #hasLink = $state(false);
  #atStartup = $state(false);

  /** The session on screen is reachable from the phone. */
  get remote(): boolean {
    return remoteState(this.tab ? (this.screens[this.tab] ?? null) : null, this.#hasLink, this.#atStartup);
  }
  #seq = 0;

  async refresh(projectPath: string, sessionId: string | null): Promise<void> {
    const my = ++this.#seq;
    try {
      const [n, url, atStartup] = await Promise.all([
        invoke<number | null>('session_usage', { projectPath, id: sessionId }),
        invoke<string | null>('session_remote', { projectPath, id: sessionId }),
        invoke<boolean>('remote_at_startup'),
      ]);
      if (my !== this.#seq) return;
      this.context = n;
      this.#hasLink = url !== null;
      this.#atStartup = atStartup;
    } catch (e) {
      console.warn('session_usage failed', e);
    }
  }
}

export const claudeUsage = new ClaudeUsage();
