import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class {
    onmessage: (m: string) => void = () => {};
  },
}));

import { invoke } from '@tauri-apps/api/core';
import { createTransport } from './lsp-client';

const inv = vi.mocked(invoke);
beforeEach(() => inv.mockClear());

const chan = () => ({ onmessage: (_: string) => {} });

describe('createTransport', () => {
  it('send goes to lsp_send with the server id', () => {
    const t = createTransport(7, chan(), () => {});
    t.send('{"a":1}');
    expect(inv).toHaveBeenCalledWith('lsp_send', { serverId: 7, message: '{"a":1}' });
  });

  it('forwards server messages to subscribers until unsubscribed', () => {
    const ch = chan();
    const t = createTransport(1, ch, () => {});
    const h = vi.fn();
    t.subscribe(h);
    ch.onmessage('{"jsonrpc":"2.0","id":1,"result":null}');
    expect(h).toHaveBeenCalledTimes(1);
    t.unsubscribe(h);
    ch.onmessage('{"jsonrpc":"2.0","id":2,"result":null}');
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('exit_message_sets_error_and_is_not_forwarded', () => {
    const ch = chan();
    const onExit = vi.fn();
    const t = createTransport(1, ch, onExit);
    const h = vi.fn();
    t.subscribe(h);
    ch.onmessage('{"jsonrpc":"2.0","method":"$/ideal/exit","params":{"code":3}}');
    expect(onExit).toHaveBeenCalledWith(3);
    expect(h).not.toHaveBeenCalled();
  });

  it('a message merely mentioning the exit method in its text is forwarded', () => {
    const ch = chan();
    const onExit = vi.fn();
    const t = createTransport(1, ch, onExit);
    const h = vi.fn();
    t.subscribe(h);
    ch.onmessage('{"jsonrpc":"2.0","method":"window/logMessage","params":{"message":"$/ideal/exit"}}');
    expect(h).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });
});
