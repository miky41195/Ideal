import { invoke } from '@tauri-apps/api/core';
import { snippetCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { dock } from '../dock/dock.svelte';
import { terminalTabs } from '../layout/terminal-tabs.svelte';
import { registerCommands } from '../palette/registry';
import { settings } from '../settings/settings.svelte';
import { setUserThemes, type Theme } from '../theme/themes';
import { showToast } from '../ui/toast.svelte';
import { parseExtensions, type UserSnippet } from './model';

/** Themes, snippets and commands from the user's extensions.json. */
class ExtensionStore {
  themes = $state.raw<Theme[]>([]);
  private snippets: UserSnippet[] = [];
  private unregister: (() => void) | null = null;

  apply(text: string | null): void {
    const { themes, snippets, commands, errors } = parseExtensions(text);
    setUserThemes(themes);
    this.themes = themes;
    this.snippets = snippets;
    this.unregister?.();
    this.unregister = registerCommands([
      ...themes.map((t) => ({ id: `theme-${t.id}`, label: `Tema: ${t.label}`, run: () => void settings.setTheme(t.id) })),
      ...commands.map((c, i) => ({
        id: `ext-${i}`,
        label: c.label,
        run: () => {
          dock.show('terminal');
          terminalTabs.add(c.run);
        },
      })),
    ]);
    if (errors.length) showToast(`extensions.json: ${errors.join(' · ')}`);
  }

  async load(): Promise<void> {
    try {
      this.apply(await invoke<string | null>('get_extensions'));
    } catch (e) {
      console.warn('extensions load failed', e);
    }
  }

  /** Completion source for the snippets of one language. */
  completions(languageId: () => string | null) {
    return (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w-]+/);
      if (!word && !context.explicit) return null;
      const id = languageId();
      const options = this.snippets
        .filter((s) => !s.languages.length || (id !== null && s.languages.includes(id)))
        .map((s) => snippetCompletion(s.body, { label: s.prefix, detail: s.label === s.prefix ? 'snippet' : s.label, type: 'text' }));
      return options.length ? { from: word?.from ?? context.pos, options } : null;
    };
  }
}

export const extensions = new ExtensionStore();
