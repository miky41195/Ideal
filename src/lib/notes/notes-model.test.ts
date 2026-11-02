import { describe, it, expect } from 'vitest';
import { parseNotes, toggle, addItem, removeItem, editItem } from './notes-model';

const MIXED = '# Note\n\n- [ ] uno\n- [x] due\ntesto libero\n- [X] tre\n- non item\n';

describe('notes-model', () => {
  it('parses items from mixed content, ignoring other lines', () => {
    expect(parseNotes(MIXED)).toEqual([
      { line: 2, done: false, text: 'uno' },
      { line: 3, done: true, text: 'due' },
      { line: 5, done: true, text: 'tre' },
    ]);
  });

  it('parses empty input', () => {
    expect(parseNotes('')).toEqual([]);
  });

  it('toggle flips only that line', () => {
    const out = toggle(MIXED, 2);
    expect(out).toBe(MIXED.replace('- [ ] uno', '- [x] uno'));
    expect(toggle(out, 2)).toBe(MIXED);
  });

  it('toggle preserves CRLF and other lines', () => {
    const crlf = '# T\r\n- [ ] a\r\nx\r\n- [x] b\r\n';
    expect(toggle(crlf, 1)).toBe('# T\r\n- [x] a\r\nx\r\n- [x] b\r\n');
    expect(toggle(crlf, 3)).toBe('# T\r\n- [ ] a\r\nx\r\n- [ ] b\r\n');
  });

  it('toggle on a non-item line is a no-op', () => {
    expect(toggle(MIXED, 0)).toBe(MIXED);
    expect(toggle(MIXED, 99)).toBe(MIXED);
  });

  it('addItem to empty', () => {
    expect(addItem('', 'ciao')).toBe('- [ ] ciao\n');
  });

  it('addItem to file without trailing newline', () => {
    expect(addItem('# T\n- [ ] a', 'b')).toBe('# T\n- [ ] a\n- [ ] b\n');
  });

  it('addItem keeps CRLF and a single trailing newline', () => {
    expect(addItem('- [ ] a\r\n', 'b')).toBe('- [ ] a\r\n- [ ] b\r\n');
  });

  it('addItem ignores blank text and flattens newlines', () => {
    expect(addItem('x\n', '   ')).toBe('x\n');
    expect(addItem('', 'a\nb')).toBe('- [ ] a b\n');
  });

  it('removeItem removes exactly that line', () => {
    expect(removeItem(MIXED, 3)).toBe('# Note\n\n- [ ] uno\ntesto libero\n- [X] tre\n- non item\n');
  });

  it('removeItem on non-item is a no-op', () => {
    expect(removeItem(MIXED, 4)).toBe(MIXED);
  });

  it('editItem replaces text keeping state, CRLF and other lines', () => {
    const crlf = 'a\r\n- [x] old\r\nb\r\n';
    expect(editItem(crlf, 1, 'nuovo')).toBe('a\r\n- [x] nuovo\r\nb\r\n');
  });

  it('editItem with blank text is a no-op', () => {
    expect(editItem(MIXED, 2, '  ')).toBe(MIXED);
  });
});

import { findItemLine } from './notes-model';

describe('findItemLine', () => {
  it('returns the item only if line and text still match', () => {
    expect(findItemLine(MIXED, 2, 'uno')).toEqual({ line: 2, done: false, text: 'uno' });
    expect(findItemLine(MIXED, 2, 'altro')).toBeNull();
    expect(findItemLine(MIXED, 4, 'testo libero')).toBeNull();
    expect(findItemLine(MIXED, 99, 'uno')).toBeNull();
  });
});
