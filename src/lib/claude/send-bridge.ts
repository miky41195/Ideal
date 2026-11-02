/** Bridge so panels can type text into the active Claude PTY (registered by ClaudeTabs). */
type Sender = (text: string) => Promise<void>;
let sender: Sender | null = null;

/** Strips CR/LF so the text can never submit the prompt. */
export function toPtyText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
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
