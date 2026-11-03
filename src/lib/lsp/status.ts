import type { LspState } from './lsp-manager.svelte';

/** Status bar text for a file's language server; null when no server is involved. */
export function lspStatusText(state: LspState | undefined, languageName: string): string | null {
  switch (state) {
    case 'ready':
      return `LSP: ${languageName} ✓`;
    case 'starting':
      return 'LSP: avvio…';
    case 'missing':
      return 'LSP: non installato';
    case 'error':
      return 'LSP: errore';
    default:
      return null;
  }
}
