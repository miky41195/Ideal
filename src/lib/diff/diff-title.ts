export const STAGED_LABEL = 'HEAD ↔ Indice';
export const UNSTAGED_LABEL = 'Indice ↔ Lavoro';

/** Tab title for a diff: basename plus a label, e.g. "a.ts (Indice ↔ Lavoro)". */
export function diffTitle(file: string, label: string): string {
  const name = file.split(/[\\/]/).filter(Boolean).pop() ?? file;
  return `${name} (${label})`;
}
