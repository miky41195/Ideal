export interface Settings {
  terminal: { shell: string | null; fontSize: number };
  editor: { fontSize: number; tabSize: number; fontFamily: string };
  theme: string;
  claudeMem: { port: number };
  /** `notify`: call back when Claude finishes or waits. `contextWarn`: tokens that colour the readout, 0 turns it off. */
  claude: { notify: boolean; contextWarn: number };
  layout: { sidebarWidth: number; panelHeight: number };
  /** Language server overrides, read by the Rust side: `false` disables a language. */
  lsp: Record<string, { command: string; args?: string[] } | false>;
}

export interface SettingsPayload {
  settings: Partial<Settings>;
  warning: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  terminal: { shell: null, fontSize: 13 },
  editor: { fontSize: 14, tabSize: 2, fontFamily: 'Cascadia Code, Consolas, monospace' },
  theme: 'ideal-dark',
  claudeMem: { port: 37777 },
  claude: { notify: true, contextWarn: 200000 },
  layout: { sidebarWidth: 260, panelHeight: 220 },
  lsp: {},
};

export const WARNING_TEXT = 'settings.json non valido, uso i default';

/** Fill any missing section/field with defaults so the UI never sees undefined. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const r = raw ?? {};
  const d = DEFAULT_SETTINGS;
  return {
    terminal: { ...d.terminal, ...r.terminal },
    editor: { ...d.editor, ...r.editor },
    theme: r.theme ?? d.theme,
    claudeMem: { ...d.claudeMem, ...r.claudeMem },
    claude: { ...d.claude, ...r.claude },
    layout: { ...d.layout, ...r.layout },
    lsp: { ...d.lsp, ...r.lsp },
  };
}

/** Maps a get_settings / settings://changed payload to store values. */
export function applyPayload(p: SettingsPayload | null | undefined): { settings: Settings; toast: string | null } {
  return { settings: normalizeSettings(p?.settings), toast: p?.warning ? WARNING_TEXT : null };
}
