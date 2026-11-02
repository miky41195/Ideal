import { marked } from 'marked';
import DOMPurify from 'dompurify';

const ALLOWED_URI = /^(?:https?:|mailto:|#|\/(?!\/)|\.\/|\.\.\/)/i;

// Only what marked emits for gfm (no forms, style, input): untrusted markdown must not inject CSS or submit forms.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div',
];
const ALLOWED_ATTR = ['href', 'title', 'class', 'align', 'rel'];

let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') node.setAttribute('rel', 'noopener');
  });
}

/** Markdown (gfm) to sanitized HTML. */
export function renderMarkdown(md: string): string {
  ensureHook();
  const html = marked.parse(md, { gfm: true, async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    FORBID_TAGS: ['img'],
  });
}
