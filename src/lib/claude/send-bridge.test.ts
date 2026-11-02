import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setClaudeSender, sendToActiveClaude, toPtyText } from './send-bridge';

describe('send-bridge', () => {
  beforeEach(() => setClaudeSender(null));

  it('toPtyText strips CR/LF so the text never submits', () => {
    expect(toPtyText('a\r\nb\nc\rd')).toBe('a b c d');
    expect(toPtyText('  ciao  ')).toBe('ciao');
  });

  it('toPtyText strips ESC, ETX, DEL and other control chars', () => {
    expect(toPtyText('a\x1b[31mb\x03c\x7fd\te')).toBe('a [31mb c d e');
  });

  it('forwards sanitized text to the registered sender', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    setClaudeSender(fn);
    await sendToActiveClaude('x\ny\r');
    expect(fn).toHaveBeenCalledWith('x y');
  });

  it('rejects when nothing is registered', async () => {
    await expect(sendToActiveClaude('x')).rejects.toThrow();
  });

  it('unregister only clears its own sender', () => {
    const a = vi.fn();
    const off = setClaudeSender(a);
    const b = vi.fn().mockResolvedValue(undefined);
    setClaudeSender(b);
    off();
    return sendToActiveClaude('z').then(() => expect(b).toHaveBeenCalled());
  });
});
