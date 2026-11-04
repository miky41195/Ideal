import { describe, expect, it } from 'vitest';
import { estimateTokens, extractDraft, formatTokens, remoteFromScreen, remoteState } from './tokens';

const rule = '─'.repeat(40);
const row = (text: string, dim = false) => ({ text, dim });

describe('estimateTokens', () => {
  it('is zero for blank text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   \n ')).toBe(0);
  });

  it('grows with the text, about one token per 3.5 characters', () => {
    expect(estimateTokens('a'.repeat(35))).toBe(10);
    expect(estimateTokens('ciao')).toBe(2);
  });
});

describe('formatTokens', () => {
  it('keeps small numbers and shortens large ones', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1500)).toBe('1,5k');
    expect(formatTokens(84_300)).toBe('84k');
    expect(formatTokens(1_250_000)).toBe('1,3M');
  });
});

describe('remote link', () => {
  it('reads the panel, and knows nothing without it', () => {
    expect(remoteFromScreen([row('This session is available in the Claude mobile app and at https://x.')])).toBe(true);
    expect(remoteFromScreen([row('> 1. Enable Remote Control  Opens a secure connection')])).toBe(false);
    expect(remoteFromScreen([row('altro testo')])).toBeNull();
  });

  it('trusts the panel over everything, then the transcript, then the setting', () => {
    expect(remoteState(false, true, true)).toBe(false);
    expect(remoteState(true, false, false)).toBe(true);
    expect(remoteState(null, true, false)).toBe(true);
    expect(remoteState(null, false, true)).toBe(true);
    expect(remoteState(null, false, false)).toBe(false);
  });
});

describe('extractDraft', () => {
  it('reads the text between the two rules of the input box', () => {
    expect(extractDraft([row('storia'), row(rule), row('> rifai la grafica'), row(rule), row('  auto mode on')])).toBe('rifai la grafica');
  });

  it('joins a multi-line draft', () => {
    expect(extractDraft([row(rule), row('> prima riga'), row('  seconda riga'), row(rule)])).toBe('prima riga\nseconda riga');
  });

  it('uses the last box on screen, not an earlier one', () => {
    expect(extractDraft([row(rule), row('> vecchio'), row(rule), row('testo'), row(rule), row('> nuovo'), row(rule)])).toBe('nuovo');
  });

  it('strips side borders', () => {
    expect(extractDraft([row(rule), row('│ > ciao   │'), row(rule)])).toBe('ciao');
  });

  it('treats a dim line as the placeholder, so an empty box', () => {
    expect(extractDraft([row(rule), row('> Try "write a test"', true), row(rule)])).toBe('');
  });

  it('recognises the suggestion text even when it is not dim', () => {
    expect(extractDraft([row(rule), row('> Try "write a test for <filepath>"'), row(rule)])).toBe('');
  });

  it('is empty when no box is on screen', () => {
    expect(extractDraft([row('solo testo'), row('altro')])).toBe('');
    expect(extractDraft([row(rule), row('> senza chiusura')])).toBe('');
  });
});
