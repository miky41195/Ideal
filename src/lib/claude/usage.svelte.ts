import { invoke } from '@tauri-apps/api/core';

/** Readout for the Claude tab on screen. */
class ClaudeUsage {
  /** Tokens Claude re-reads on the next send, from the session's last real reply. Null before the first reply. */
  context = $state<number | null>(null);
  /** Rough size of what is typed in the input box. */
  draft = $state(0);
  #seq = 0;

  async refresh(projectPath: string, sessionId: string | null): Promise<void> {
    const my = ++this.#seq;
    try {
      const n = await invoke<number | null>('session_usage', { projectPath, id: sessionId });
      if (my === this.#seq) this.context = n;
    } catch (e) {
      console.warn('session_usage failed', e);
    }
  }
}

export const claudeUsage = new ClaudeUsage();
