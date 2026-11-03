import { describe, it, expect } from 'vitest';
import { toCmDiagnostics, OPEN_PULLS_MS, pullDiagnostics } from './pull-diagnostics';

const r = (l1: number, c1: number, l2: number, c2: number) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });
// toy document: each line 10 chars
const toPos = (p: { line: number; character: number }) => p.line * 10 + p.character;

describe('toCmDiagnostics', () => {
  it('maps range, severity and message', () => {
    const d = toCmDiagnostics(
      [
        { range: r(1, 2, 1, 5), severity: 2, message: 'snake case', source: 'rust-analyzer' },
        { range: r(0, 0, 0, 1), message: 'no severity = error' },
        { range: r(2, 0, 2, 0), severity: 4, message: 'hint' },
      ],
      toPos,
    );
    expect(d[0]).toEqual({ from: 12, to: 15, severity: 'warning', message: 'snake case', source: 'rust-analyzer' });
    expect(d[1].severity).toBe('error');
    expect(d[2].severity).toBe('hint');
  });
  it('never produces to < from', () => {
    const d = toCmDiagnostics([{ range: r(3, 5, 3, 1), severity: 1, message: 'x' }], toPos);
    expect(d[0].to).toBeGreaterThanOrEqual(d[0].from);
  });
});

describe('pullDiagnostics', () => {
  it('advertises pull capability and a bounded open schedule', () => {
    const ext = pullDiagnostics();
    expect(ext.clientCapabilities).toMatchObject({ textDocument: { diagnostic: {} } });
    expect(ext.editorExtension).toBeTruthy();
    expect(OPEN_PULLS_MS.length).toBeLessThanOrEqual(5);
    expect(Math.max(...OPEN_PULLS_MS)).toBeLessThanOrEqual(60_000);
  });
});
