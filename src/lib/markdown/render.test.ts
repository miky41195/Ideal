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
  it('forbids images (no automatic network)', () => {
    expect(renderMarkdown('![x](https://example.com/a.png)')).not.toContain('<img');
  });
  it('strips style tags and style attributes', () => {
    expect(renderMarkdown('<style>body{display:none}</style>hi')).not.toContain('<style');
    expect(renderMarkdown('<p style="position:fixed">x</p>')).not.toContain('style=');
  });
  it('strips form controls', () => {
    const h = renderMarkdown('<form action="x"><input name="a"><button>go</button><textarea>t</textarea><select><option>o</option></select></form>');
    for (const t of ['<form', '<input', '<button', '<textarea', '<select']) expect(h).not.toContain(t);
  });
  it('still renders normal markdown', () => {
    const h = renderMarkdown('# T\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```ts\nlet a;\n```\n\n[l](https://e.com)');
    for (const t of ['<h1', '<ul>', '<li>', '<table>', '<th>', '<td>', 'class="language-ts"', 'href="https://e.com"']) expect(h).toContain(t);
  });
  it('rejects protocol-relative links', () => {
    expect(renderMarkdown('[x](//evil.com/a)')).not.toContain('//evil.com');
  });
});
