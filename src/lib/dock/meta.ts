import { isExtra, kindOf, type BlockId, type CoreBlock } from './dock-tree';
import type { IconName } from '../ui/Icon.svelte';

export const BLOCK_META: Record<CoreBlock, { label: string; icon: IconName }> = {
  claude: { label: 'Claude', icon: 'spark' },
  editor: { label: 'Editor', icon: 'code' },
  terminal: { label: 'Terminale', icon: 'terminal' },
  explorer: { label: 'File', icon: 'files' },
  git: { label: 'Git', icon: 'branch' },
  changes: { label: 'Modifiche', icon: 'diff' },
  search: { label: 'Cerca', icon: 'search' },
  notes: { label: 'Note', icon: 'note' },
  hub: { label: 'Hub', icon: 'layers' },
  commands: { label: 'Comandi', icon: 'play' },
  preview: { label: 'Anteprima', icon: 'globe' },
};

/** `terminal:2` reads "Terminale 2". */
export function blockMeta(b: BlockId): { label: string; icon: IconName } {
  const core = BLOCK_META[kindOf(b)];
  return isExtra(b) ? { ...core, label: `${core.label} ${b.split(':')[1]}` } : core;
}
