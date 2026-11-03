const BS = String.fromCharCode(92);
const DRIVE = /^([A-Za-z]):$/;

/** `C:\Users\a b\x.ts` -> `file:///C:/Users/a%20b/x.ts` (per-segment encoding, drive letter upper, colon kept). */
export function pathToUri(path: string): string {
  const segs = path.split(BS).join('/').split('/');
  const out: string[] = [];
  segs.forEach((seg, i) => {
    const m = i === 0 ? DRIVE.exec(seg) : null;
    out.push(m ? `${m[1].toUpperCase()}:` : encodeURIComponent(seg));
  });
  const joined = out.join('/');
  return joined.startsWith('/') ? `file://${joined}` : `file:///${joined}`;
}

/** Inverse of `pathToUri`; also accepts server-style `file:///c%3A/...`. Drive paths come back with backslashes. */
export function uriToPath(uri: string): string {
  const rest = uri.replace(/^file:\/\//i, '');
  const segs = rest.split('/').map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  // segs[0] is '' (leading slash); a drive path looks like ['', 'c:', 'Users', ...]
  const m = segs.length > 1 ? DRIVE.exec(segs[1]) : null;
  if (m) return [`${m[1].toUpperCase()}:`, ...segs.slice(2)].join(BS);
  return segs.join('/');
}

/**
 * Rewrites every `file:///` URI string in a raw JSON-RPC message to our canonical form
 * (`pathToUri(uriToPath(u))`). Servers echo URIs in their own spelling (rust-analyzer:
 * `file:///c%3A/...`), and the client matches files by exact URI string.
 */
export function canonicalizeUris(raw: string): string {
  if (!raw.includes('file:///')) return raw;
  return raw.replace(/"(file:\/\/\/[^"\\]*)"/g, (_m, uri: string) => `"${pathToUri(uriToPath(uri))}"`);
}
