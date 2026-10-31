// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render';

describe('renderMarkdown', () => {
  it('strips script tags', () => {
    expect(renderMarkdown('hi <script>alert(1)</script>')).not.toContain('<script');
  });
  it('strips img onerror', () => {
    const h = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(h).not.toContain('onerror');
  });
  it('blocks javascript: href', () => {
    const h = renderMarkdown('[x](javascript:alert(1))');
    expect(h).not.toContain('javascript:');
  });
  it('keeps code blocks and sets rel on anchors', () => {
    const h = renderMarkdown('```ts\nconst a = 1;\n```\n\n[ok](https://example.com)');
    expect(h).toContain('<pre>');
    expect(h).toContain('<code');
    expect(h).toContain('rel="noopener"');
  });
});
