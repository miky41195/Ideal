import { describe, it, expect, vi } from 'vitest';
import { registerCommands, listCommands, filterCommands, formatBinding, type PaletteCommand } from './registry';

const cmd = (id: string, label: string, extra: Partial<PaletteCommand> = {}): PaletteCommand => ({ id, label, run: () => {}, ...extra });

describe('registry', () => {
  it('registers, lists sorted by label, and unregisters', () => {
    const off = registerCommands([cmd('b', 'Beta'), cmd('a', 'Alfa')]);
    expect(listCommands().map((c) => c.id)).toEqual(['a', 'b']);
    off();
    expect(listCommands()).toEqual([]);
  });
  it('when() hides commands', () => {
    let on = false;
    const off = registerCommands([cmd('x', 'X', { when: () => on })]);
    expect(listCommands()).toHaveLength(0);
    on = true;
    expect(listCommands()).toHaveLength(1);
    off();
  });
  it('re-registering an id replaces it', () => {
    const run = vi.fn();
    const off1 = registerCommands([cmd('a', 'Old')]);
    const off2 = registerCommands([cmd('a', 'New', { run })]);
    expect(listCommands().map((c) => c.label)).toEqual(['New']);
    off1();
    off2();
  });
});

describe('filterCommands', () => {
  const all = [cmd('1', 'Salva'), cmd('2', 'Salva tutto'), cmd('3', 'Chiudi tab'), cmd('4', 'Nuova tab Claude')];
  it('ranks by fuzzy score', () => {
    expect(filterCommands('salva t', all)[0].label).toBe('Salva tutto');
  });
  it('drops non-matches, empty query keeps all', () => {
    expect(filterCommands('zzz', all)).toEqual([]);
    expect(filterCommands('', all)).toHaveLength(4);
  });
});

describe('formatBinding', () => {
  it('formats Ctrl+Shift bindings', () => {
    expect(formatBinding('toggleMode')).toBe('Ctrl+Shift+E');
    expect(formatBinding('quickOpenAny')).toBe('Ctrl+Shift+O');
    expect(formatBinding('searchProject')).toBe('Ctrl+Shift+F');
    expect(formatBinding('togglePanel')).toBe('Ctrl+Shift+`');
  });
  it('is undefined without a binding', () => {
    expect(formatBinding('nonexistent' as never)).toBeUndefined();
  });
});
