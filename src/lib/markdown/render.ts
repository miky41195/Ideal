import { marked } from 'marked';
import DOMPurify from 'dompurify';

const ALLOWED_URI = /^(?:https?:|mailto:|#|\/(?!\/)|\.\/|\.\.\/)/i;

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
  return DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: ALLOWED_URI, FORBID_TAGS: ['img'] });
}
