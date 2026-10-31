import type { Command } from './keys/router';

const listeners = new Map<Command, Set<() => void>>();

export function dispatch(cmd: Command): void {
  listeners.get(cmd)?.forEach((fn) => fn());
}

export function onCommand(cmd: Command, fn: () => void): () => void {
  let set = listeners.get(cmd);
  if (!set) listeners.set(cmd, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}
