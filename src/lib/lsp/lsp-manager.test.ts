import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LspManager, IDLE_MS, type LspDeps, type ClientLike } from './lsp-manager.svelte';

const bs = String.fromCharCode(92);
const P = (name: string) => ['C:', 'p', name].join(bs);
const ROOT = ['C:', 'p'].join(bs);

type FakeClient = ClientLike & { disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };

function setup(startImpl?: LspDeps['start']) {
  let nextId = 1;
  const exits: Record<number, (code: number | null) => void> = {};
  const clients: FakeClient[] = [];
  const deps = {
    start: vi.fn(
      startImpl ??
        (async (_lang: string, _root: string, onExit: (c: number | null) => void) => {
          const serverId = nextId++;
          exits[serverId] = onExit;
          return { serverId, transport: { send: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() } };
        }),
    ),
    stop: vi.fn(async () => {}),
    createClient: vi.fn((rootUri: string) => {
      const c = {
        rootUri,
        initializing: Promise.resolve(null),
        connect: vi.fn(),
        disconnect: vi.fn(),
        plugin: vi.fn((uri: string, lang: string) => ({ ext: uri + '|' + lang })),
      };
      clients.push(c as unknown as FakeClient);
      return c as unknown as ClientLike;
    }),
    notify: vi.fn(),
  };
  return { m: new LspManager(deps as unknown as LspDeps), deps, clients, exits };
}

describe('LspManager', () => {
  it('unknown language -> null, no server', async () => {
    const { m, deps } = setup();
    expect(await m.extensionFor(P('a.md'), ROOT)).toBeNull();
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('one_server_for_concurrent_opens', async () => {
    const { m, deps, clients } = setup();
    const [a, b, c] = await Promise.all([
      m.extensionFor(P('a.ts'), ROOT),
      m.extensionFor(P('b.ts'), ROOT),
      m.extensionFor(P('c.ts'), ROOT),
    ]);
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ext: 'file:///C:/p/a.ts|typescript' });
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(m.state['typescript-language-server']).toBe('ready');
  });

  it('ts_and_js_share_server', async () => {
    const { m, deps } = setup();
    await m.extensionFor(P('a.ts'), ROOT);
    await m.extensionFor(P('b.js'), ROOT);
    await m.extensionFor(P('c.tsx'), ROOT);
    expect(deps.start).toHaveBeenCalledTimes(1);
  });

  it('different servers start separately', async () => {
    const { m, deps } = setup();
    await m.extensionFor(P('a.ts'), ROOT);
    await m.extensionFor(P('a.py'), ROOT);
    expect(deps.start).toHaveBeenCalledTimes(2);
  });

  it('missing_notice_once', async () => {
    const err = { missing: true, command: 'pyright-langserver', install: 'npm i -g pyright', message: 'x' };
    const { m, deps } = setup(async () => {
      throw err;
    });
    expect(await m.extensionFor(P('a.py'), ROOT)).toBeNull();
    expect(await m.extensionFor(P('b.py'), ROOT)).toBeNull();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith('Server python non installato — installa con: npm i -g pyright');
    expect(deps.start).toHaveBeenCalledTimes(1); // no retry loop
    expect(m.state['pyright-langserver']).toBe('missing');
  });

  it('non-missing start failure -> error state, no retry', async () => {
    const { m, deps } = setup(async () => {
      throw { missing: false, command: 'gopls', install: '', message: 'boom' };
    });
    expect(await m.extensionFor(P('a.go'), ROOT)).toBeNull();
    expect(await m.extensionFor(P('b.go'), ROOT)).toBeNull();
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(m.state['gopls']).toBe('error');
  });

  it('exit callback sets error, disconnects, and does not restart', async () => {
    const { m, deps, exits, clients } = setup();
    await m.extensionFor(P('a.ts'), ROOT);
    exits[1](1);
    expect(m.state['typescript-language-server']).toBe('error');
    expect(clients[0].disconnect).toHaveBeenCalled();
    expect(await m.extensionFor(P('b.ts'), ROOT)).toBeNull();
    expect(deps.start).toHaveBeenCalledTimes(1);
  });

  describe('idle stop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('idle_stop_after_last_close', async () => {
      const { m, deps, clients } = setup();
      m.opened(P('a.ts'));
      m.opened(P('b.js'));
      await m.extensionFor(P('a.ts'), ROOT);
      m.closed(P('a.ts'));
      await vi.advanceTimersByTimeAsync(IDLE_MS + 1000);
      expect(deps.stop).not.toHaveBeenCalled(); // b.js still open
      m.closed(P('b.js'));
      await vi.advanceTimersByTimeAsync(299_000);
      expect(deps.stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(deps.stop).toHaveBeenCalledWith(1);
      expect(clients[0].disconnect).toHaveBeenCalled();
      expect(m.state['typescript-language-server']).toBeUndefined();
    });

    it('reopen before expiry cancels the timer', async () => {
      const { m, deps } = setup();
      m.opened(P('a.ts'));
      await m.extensionFor(P('a.ts'), ROOT);
      m.closed(P('a.ts'));
      await vi.advanceTimersByTimeAsync(100_000);
      m.opened(P('a.ts'));
      await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
      expect(deps.stop).not.toHaveBeenCalled();
    });

    it('a stopped server restarts on next open', async () => {
      const { m, deps } = setup();
      m.opened(P('a.ts'));
      await m.extensionFor(P('a.ts'), ROOT);
      m.closed(P('a.ts'));
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      m.opened(P('a.ts'));
      await m.extensionFor(P('a.ts'), ROOT);
      expect(deps.start).toHaveBeenCalledTimes(2);
    });

    it('stray closed() never goes negative', async () => {
      const { m } = setup();
      m.closed(P('a.ts'));
      m.opened(P('a.ts'));
      m.closed(P('a.ts'));
      await vi.advanceTimersByTimeAsync(IDLE_MS);
    });
  });

  it('stopAll stops every running server', async () => {
    const { m, deps } = setup();
    await m.extensionFor(P('a.ts'), ROOT);
    await m.extensionFor(P('a.py'), ROOT);
    await m.stopAll();
    expect(deps.stop).toHaveBeenCalledTimes(2);
    expect(m.state).toEqual({});
  });

  describe('retry / showMissing', () => {
    it('retry clears an error so the next extensionFor restarts', async () => {
      const { m, deps, exits } = setup();
      await m.extensionFor(P('a.ts'), ROOT);
      exits[1](1);
      expect(await m.extensionFor(P('a.ts'), ROOT)).toBeNull();
      m.retry('typescript-language-server');
      expect(m.state['typescript-language-server']).toBeUndefined();
      expect(await m.extensionFor(P('a.ts'), ROOT)).not.toBeNull();
      expect(deps.start).toHaveBeenCalledTimes(2);
    });

    it('retry on a missing server re-arms the notice', async () => {
      let n = 0;
      const err = { missing: true, command: 'gopls', install: 'go install x', message: '' };
      const { m, deps } = setup(async () => {
        n++;
        throw err;
      });
      await m.extensionFor(P('a.go'), ROOT);
      m.retry('gopls');
      await m.extensionFor(P('a.go'), ROOT);
      expect(n).toBe(2);
      expect(deps.notify).toHaveBeenCalledTimes(2);
    });

    it('retry does nothing for a ready server', async () => {
      const { m, deps } = setup();
      await m.extensionFor(P('a.ts'), ROOT);
      m.retry('typescript-language-server');
      expect(m.state['typescript-language-server']).toBe('ready');
      expect(deps.start).toHaveBeenCalledTimes(1);
    });

    it('showMissing re-shows the install notice without restarting', async () => {
      const err = { missing: true, command: 'gopls', install: 'go install x', message: '' };
      const { m, deps } = setup(async () => {
        throw err;
      });
      await m.extensionFor(P('a.go'), ROOT);
      m.showMissing('gopls');
      expect(deps.notify).toHaveBeenCalledTimes(2);
      expect(deps.notify).toHaveBeenLastCalledWith('Server go non installato — installa con: go install x');
      expect(deps.start).toHaveBeenCalledTimes(1);
    });

    it('retry bumps the attach tick so editors re-request their extension', async () => {
      const { m, exits } = setup();
      await m.extensionFor(P('a.ts'), ROOT);
      exits[1](1);
      const before = m.tick;
      m.retry('typescript-language-server');
      expect(m.tick).toBe(before + 1);
    });
  });
});
