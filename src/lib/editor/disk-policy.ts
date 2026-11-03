export type DiskDecision = 'ignore' | 'reload' | 'conflict' | 'deleted';

/**
 * What to do when the file behind a tab changed on disk. All texts are LF-normalized.
 * `disk === null` means the file is gone.
 */
export function decideDiskChange(tab: { content: string; savedContent: string }, disk: string | null): DiskDecision {
  if (disk === null) return 'deleted';
  if (disk === tab.savedContent) return 'ignore'; // our own save, or no real change
  if (tab.content === tab.savedContent) return 'reload';
  if (disk === tab.content) return 'ignore'; // caller adopts disk as savedContent
  return 'conflict';
}

/** Clamps a selection into `[0, docLen]` after the document was replaced. */
export function clampSelection(sel: { anchor: number; head: number }, docLen: number): { anchor: number; head: number } {
  const c = (n: number) => Math.min(Math.max(0, n), docLen);
  return { anchor: c(sel.anchor), head: c(sel.head) };
}
