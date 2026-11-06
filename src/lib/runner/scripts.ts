export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface Script {
  name: string;
  command: string;
}

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

/** Names reach a shell, and package.json may come from any repo: odd ones are not offered. */
const SAFE_NAME = /^[\w:.-]+$/;

function parse(text: string): Record<string, unknown> | null {
  try {
    const json: unknown = JSON.parse(text);
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The runnable scripts of a package.json; null when the text is not a package.json. */
export function parseScripts(text: string): Script[] | null {
  const json = parse(text);
  if (!json) return null;
  const scripts = json.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  return Object.entries(scripts)
    .filter(([name, command]) => SAFE_NAME.test(name) && typeof command === 'string')
    .map(([name, command]) => ({ name, command: command as string }));
}

/** The `packageManager` field wins, then the lockfile in the folder. */
export function packageManager(text: string, files: string[]): PackageManager {
  const field = parse(text)?.packageManager;
  const named = typeof field === 'string' ? field.split('@')[0] : '';
  if (named === 'npm' || named === 'pnpm' || named === 'yarn' || named === 'bun') return named;
  return LOCKFILES.find(([file]) => files.includes(file))?.[1] ?? 'npm';
}

export const runLine = (pm: PackageManager, name: string): string => `${pm} run ${name}`;
