import { describe, it, expect } from 'vitest';
import { lspStatusText } from './status';

describe('lspStatusText', () => {
  it('maps each state', () => {
    expect(lspStatusText('ready', 'TypeScript')).toBe('LSP: TypeScript attivo');
    expect(lspStatusText('starting', 'TypeScript')).toBe('LSP: avvio…');
    expect(lspStatusText('missing', 'Python')).toBe('LSP: non installato, clic per installare');
    expect(lspStatusText('error', 'Go')).toBe('LSP: errore');
  });
  it('is null when no server is involved', () => {
    expect(lspStatusText(undefined, 'TypeScript')).toBeNull();
  });
});
