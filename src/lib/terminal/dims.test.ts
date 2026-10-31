import { describe, it, expect } from 'vitest';
import { safeDims } from './dims';

describe('safeDims', () => {
  it('rejects zero or tiny sizes', () => {
    expect(safeDims(0, 24)).toBeNull();
    expect(safeDims(80, 0)).toBeNull();
    expect(safeDims(1, 24)).toBeNull();
  });
  it('accepts valid sizes', () => {
    expect(safeDims(80, 24)).toEqual({ cols: 80, rows: 24 });
  });
});
