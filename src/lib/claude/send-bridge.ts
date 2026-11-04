/** Bridge so panels can type text into the active Claude PTY (registered by ClaudeTabs). */
type Sender = (text: string, submit?: boolean) => Promise<void>;
let sender: Sender | null = null;

/** Strips all control chars (CR/LF submit, ESC/ETX inject terminal sequences) so typed text stays inert. */
export function toPtyText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
}

export function setClaudeSender(fn: Sender | null): () => void {
  sender = fn;
  return () => {
    if (sender === fn) sender = null;
  };
}

export function sendToActiveClaude(text: string): Promise<void> {
  if (!sender) return Promise.reject(new Error('Claude non disponibile'));
  return sender(toPtyText(text));
}

/** Types a slash command and presses Enter. */
export function runInActiveClaude(command: string): Promise<void> {
  if (!sender) return Promise.reject(new Error('Claude non disponibile'));
  return sender(toPtyText(command), true);
}
