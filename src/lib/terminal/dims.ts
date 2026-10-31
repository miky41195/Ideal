export function safeDims(cols: number, rows: number): { cols: number; rows: number } | null {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return null;
  return { cols: Math.floor(cols), rows: Math.floor(rows) };
}
