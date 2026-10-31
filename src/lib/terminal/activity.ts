const listeners = new Set<() => void>();

/** Called by terminals on every chunk of PTY output. */
export function notifyTerminalActivity(): void {
  listeners.forEach((f) => f());
}

/** Subscribe to PTY output activity; returns an unsubscribe fn. */
export function onTerminalActivity(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Trailing debounce: `fn` runs once, `ms` after the last call. `cancel` drops a pending run. */
export function debounce(fn: () => void, ms: number): (() => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const d = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
  d.cancel = () => clearTimeout(timer);
  return d;
}
