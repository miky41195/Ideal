import { describe, it, expect } from 'vitest';
import { createQueue } from './serial-queue';

describe('createQueue', () => {
  it('runs tasks in order without overlap, even after a failure', async () => {
    const run = createQueue();
    const log: string[] = [];
    const slow = (n: string, ms: number, fail = false) => () =>
      new Promise<string>((res, rej) => {
        log.push(`start ${n}`);
        setTimeout(() => {
          log.push(`end ${n}`);
          fail ? rej(new Error(n)) : res(n);
        }, ms);
      });
    const a = run(slow('a', 20));
    const b = run(slow('b', 1, true));
    const c = run(slow('c', 1));
    await expect(b).rejects.toThrow('b');
    expect(await a).toBe('a');
    expect(await c).toBe('c');
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});
