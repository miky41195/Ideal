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

describe('safeDims edge cases', () => {
  it('rejects NaN/Infinity', () => {
    expect(safeDims(NaN, 24)).toBeNull();
    expect(safeDims(80, Infinity)).toBeNull();
  });
  it('floors non-integers', () => {
    expect(safeDims(80.7, 24.2)).toEqual({ cols: 80, rows: 24 });
  });
  it('rejects values that floor below 2', () => {
    expect(safeDims(1.9, 24)).toBeNull();
  });
});
