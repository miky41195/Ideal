import { describe, it, expect } from 'vitest';
import { decideDiskChange, clampSelection } from './disk-policy';

describe('decideDiskChange', () => {
  it('own_save_is_ignored: disk equals savedContent', () => {
    expect(decideDiskChange({ content: 'a', savedContent: 'a' }, 'a')).toBe('ignore');
    expect(decideDiskChange({ content: 'edit', savedContent: 'a' }, 'a')).toBe('ignore');
  });
  it('deleted when disk is null', () => {
    expect(decideDiskChange({ content: 'a', savedContent: 'a' }, null)).toBe('deleted');
  });
  it('clean + changed disk reloads', () => {
    expect(decideDiskChange({ content: 'a', savedContent: 'a' }, 'b')).toBe('reload');
  });
  it('dirty and disk equals buffer is ignored', () => {
    expect(decideDiskChange({ content: 'x', savedContent: 'a' }, 'x')).toBe('ignore');
  });
  it('dirty and different disk conflicts', () => {
    expect(decideDiskChange({ content: 'x', savedContent: 'a' }, 'b')).toBe('conflict');
  });
});

describe('clampSelection', () => {
  it('clamps anchor and head to doc length', () => {
    expect(clampSelection({ anchor: 10, head: 20 }, 5)).toEqual({ anchor: 5, head: 5 });
    expect(clampSelection({ anchor: 2, head: 3 }, 5)).toEqual({ anchor: 2, head: 3 });
    expect(clampSelection({ anchor: -1, head: 0 }, 0)).toEqual({ anchor: 0, head: 0 });
  });
});
