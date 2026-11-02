import { describe, it, expect, vi, beforeEach } from 'vitest';

const readTextFile = vi.fn();
vi.mock('../fs-client', () => ({ readTextFile: (p: string) => readTextFile(p), writeTextFile: vi.fn(), createDir: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { loadNotes } from './notes-client';

describe('loadNotes', () => {
  beforeEach(() => {
    readTextFile.mockReset();
  });

  it('returns the file content', async () => {
    readTextFile.mockResolvedValue({ content: '- [ ] a\r\n', eol: 'crlf', readonly: false, reason: null });
    expect(await loadNotes('C:\p')).toEqual({ md: '- [ ] a\r\n', eol: 'crlf' });
  });

  it('missing file -> empty', async () => {
    readTextFile.mockImplementation(() => Promise.reject('Impossibile trovare il file specificato. (os error 2)'));
    expect(await loadNotes('C:\p')).toEqual({ md: '', eol: 'lf' });
  });

  it('other read errors are rethrown (never overwrite an unreadable file)', async () => {
    readTextFile.mockImplementation(() => Promise.reject('Accesso negato. (os error 5)'));
    await expect(loadNotes('C:\p')).rejects.toBeTruthy();
  });

  it('readonly (binary/too large) is rethrown', async () => {
    readTextFile.mockResolvedValue({ content: '', eol: 'lf', readonly: true, reason: 'binario' });
    await expect(loadNotes('C:\p')).rejects.toThrow('binario');
  });
});
