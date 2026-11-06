const LOCAL = new Set(['localhost', '127.0.0.1']);

/**
 * What the user typed in the address bar as a URL the block may load: `3000` means that local
 * port. The CSP only allows frames from https and local servers, so anything else is null.
 */
export function previewUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d{1,5}$/.test(text)) return `http://localhost:${text}/`;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const local = /^(localhost|127\.0\.0\.1)([:/]|$)/i.test(text);
  try {
    const url = new URL(hasScheme ? text : `${local ? 'http' : 'https'}://${text}`);
    if (url.protocol === 'https:') return url.href;
    return url.protocol === 'http:' && LOCAL.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}
