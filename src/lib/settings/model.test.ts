import { describe, it, expect } from 'vitest';
import { applyPayload, normalizeSettings, DEFAULT_SETTINGS, WARNING_TEXT } from './model';

describe('settings model', () => {
  it('fills missing fields with defaults', () => {
    const s = normalizeSettings({ editor: { fontSize: 20 } as never });
    expect(s.editor).toEqual({ ...DEFAULT_SETTINGS.editor, fontSize: 20 });
    expect(s.terminal.fontSize).toBe(13);
  });
  it('warning maps to the toast text', () => {
    expect(applyPayload({ settings: {}, warning: 'x' }).toast).toBe(WARNING_TEXT);
    expect(applyPayload({ settings: {}, warning: null }).toast).toBeNull();
  });
  it('tolerates a null payload', () => {
    expect(applyPayload(null).settings).toEqual(DEFAULT_SETTINGS);
  });
});
