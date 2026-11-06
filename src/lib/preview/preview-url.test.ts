import { describe, expect, it } from 'vitest';
import { previewUrl } from './preview-url';

describe('previewUrl', () => {
  it('reads a bare number as a local port', () => {
    expect(previewUrl('5173')).toBe('http://localhost:5173/');
  });

  it('completes local addresses with http', () => {
    expect(previewUrl(' localhost:3000/app ')).toBe('http://localhost:3000/app');
    expect(previewUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/');
  });

  it('completes other hosts with https', () => {
    expect(previewUrl('example.com')).toBe('https://example.com/');
  });

  it('keeps full addresses it allows', () => {
    expect(previewUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(previewUrl('http://localhost:1420/')).toBe('http://localhost:1420/');
  });

  it('refuses what the frame policy would block', () => {
    for (const bad of ['', '   ', 'http://example.com', 'file:///C:/x.html', 'ftp://a.b', 'javascript:alert(1)', 'data:text/html,x']) {
      expect(previewUrl(bad)).toBeNull();
    }
  });

  it('is not fooled by a local name inside another host', () => {
    expect(previewUrl('http://localhost.evil.com')).toBeNull();
    expect(previewUrl('localhost.evil.com')).toBe('https://localhost.evil.com/');
  });
});
