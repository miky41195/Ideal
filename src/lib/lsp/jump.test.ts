import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayTarget, setFileOpener } from './jump';

describe('displayTarget', () => {
  afterEach(() => setFileOpener(null));

  it('is null with no opener or an unreadable file', async () => {
    expect(await displayTarget('file:///C:/a.ts')).toBeNull();
    setFileOpener({ read: async () => null, reveal: vi.fn() });
    expect(await displayTarget('file:///C:/a.ts')).toBeNull();
  });

  it('turns a selection into a line and column in the right file', async () => {
    const reveal = vi.fn();
    setFileOpener({ read: async () => 'uno\r\ndue\ntre', reveal });
    const t = (await displayTarget('file:///C:/x/a%20b.ts'))!;
    expect(t.state.doc.lines).toBe(3);
    t.dispatch({ selection: { anchor: 6 } });
    expect(reveal).toHaveBeenCalledWith('C:\\x\\a b.ts', 2, 2);
  });

  it('ignores a dispatch with no selection', async () => {
    const reveal = vi.fn();
    setFileOpener({ read: async () => 'uno', reveal });
    (await displayTarget('file:///C:/a.ts'))!.dispatch({});
    expect(reveal).not.toHaveBeenCalled();
  });
});
