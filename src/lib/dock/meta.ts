import type { BlockId } from './dock-tree';
import type { IconName } from '../ui/Icon.svelte';

export const BLOCK_META: Record<BlockId, { label: string; icon: IconName }> = {
  claude: { label: 'Claude', icon: 'spark' },
  editor: { label: 'Editor', icon: 'code' },
  terminal: { label: 'Terminale', icon: 'terminal' },
  explorer: { label: 'File', icon: 'files' },
  git: { label: 'Git', icon: 'branch' },
  changes: { label: 'Modifiche', icon: 'diff' },
  search: { label: 'Cerca', icon: 'search' },
  notes: { label: 'Note', icon: 'note' },
  hub: { label: 'Hub', icon: 'layers' },
};
