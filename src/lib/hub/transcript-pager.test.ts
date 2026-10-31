import { describe, it, expect, vi } from 'vitest';
import { TranscriptPager } from './transcript-pager';

const e = (t: string) => ({ kind: 'user', text: t, tool: null, ts: 0 });

describe('TranscriptPager', () => {
  it('loads first page then appends on more', async () => {
    const read = vi.fn(async (o: number) => ({ entries: o === 0 ? [e('a'), e('b')] : [e('c')], total: 3 }));
    const p = new TranscriptPager(read, () => {}, 2);
    await p.more();
    expect(p.entries).toHaveLength(2);
    await p.more();
    expect(p.entries.map((x) => x.text)).toEqual(['a', 'b', 'c']);
    expect(read).toHaveBeenLastCalledWith(2, 2);
    expect(p.total).toBe(3);
  });

  it('reset discards stale response and loads new source', async () => {
    let release!: (v: { entries: ReturnType<typeof e>[]; total: number }) => void;
    const p = new TranscriptPager(() => new Promise((r) => (release = r)));
    const first = p.more();
    p.reset(async () => ({ entries: [e('new')], total: 1 }));
    await p.more();
    release({ entries: [e('old')], total: 1 });
    await first;
    expect(p.entries.map((x) => x.text)).toEqual(['new']);
    expect(p.loading).toBe(false);
  });
});
