/** One source of truth for every theme: UI tokens, syntax colours and the terminal palette. */

export interface Syntax {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  func: string;
  type: string;
}

export interface Theme {
  id: string;
  label: string;
  kind: 'dark' | 'light';
  /** Window ground: carries the theme's colour around the blocks. */
  canvas: string;
  canvasText: string;
  canvasDim: string;
  /** Editor and terminal surface. */
  bg: string;
  /** Block surface: headers and side panels. */
  panel: string;
  /** Hover and selected rows. */
  panel2: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentFg: string;
  danger: string;
  success: string;
  warn: string;
  syntax: Syntax;
  /** black red green yellow blue magenta cyan white, then the bright eight. */
  ansi: string[];
}

const darkAnsi = (blue: string, magenta: string, cyan: string) => [
  '#2a2d33', '#f2777a', '#8fd18a', '#e9c46a', blue, magenta, cyan, '#d9dce2',
  '#6b707a', '#ff9a9c', '#a9e6a4', '#f4d88c', blue, magenta, cyan, '#ffffff',
];

const lightAnsi = (blue: string, magenta: string, cyan: string) => [
  '#2b2f38', '#b3261e', '#1f7a3d', '#8a5a00', blue, magenta, cyan, '#5c6370',
  '#4a4f5a', '#c8352c', '#23884a', '#9c6800', blue, magenta, cyan, '#3a3f4a',
];

export const THEMES: Theme[] = [
  {
    id: 'grafite',
    label: 'Grafite',
    kind: 'dark',
    canvas: '#35302a',
    canvasText: '#f4f0ea',
    canvasDim: '#c9c3b8',
    bg: '#16171a',
    panel: '#1b1c20',
    panel2: '#272930',
    border: '#2d2f36',
    text: '#ececef',
    textDim: '#a3a6ae',
    accent: '#f5a524',
    accentFg: '#1c1304',
    danger: '#f2777a',
    success: '#7ed492',
    warn: '#f5c451',
    syntax: { keyword: '#f5a524', string: '#a8d98f', number: '#f0a6a0', comment: '#8a8d96', func: '#8cc4ff', type: '#e9c98a' },
    ansi: darkAnsi('#8cc4ff', '#d7a6f0', '#7fd6cf'),
  },
  {
    id: 'notte',
    label: 'Notte',
    kind: 'dark',
    canvas: '#1c2a5e',
    canvasText: '#e9edfa',
    canvasDim: '#b6c0de',
    bg: '#0e1322',
    panel: '#131a2d',
    panel2: '#202a47',
    border: '#2a3454',
    text: '#e7ebf7',
    textDim: '#a2acc8',
    accent: '#82a8ff',
    accentFg: '#0a1330',
    danger: '#ff8a8f',
    success: '#7fe0b0',
    warn: '#f7cf6b',
    syntax: { keyword: '#b79cff', string: '#8fe0c0', number: '#ffb38a', comment: '#8390b4', func: '#82a8ff', type: '#7fd8f0' },
    ansi: darkAnsi('#82a8ff', '#b79cff', '#7fd8f0'),
  },
  {
    id: 'bosco',
    label: 'Bosco',
    kind: 'dark',
    canvas: '#14493a',
    canvasText: '#e6f2ed',
    canvasDim: '#b0d0c5',
    bg: '#0d1917',
    panel: '#11211d',
    panel2: '#1c332d',
    border: '#28423b',
    text: '#e6f0ec',
    textDim: '#9fb8b0',
    accent: '#52d6a8',
    accentFg: '#05201a',
    danger: '#ff8f85',
    success: '#7fe0a8',
    warn: '#ecd06f',
    syntax: { keyword: '#52d6a8', string: '#d6d68a', number: '#f2ae87', comment: '#7f9a92', func: '#8cd0f0', type: '#b6e08c' },
    ansi: darkAnsi('#8cd0f0', '#d4a6e0', '#52d6a8'),
  },
  {
    id: 'prugna',
    label: 'Prugna',
    kind: 'dark',
    canvas: '#43235a',
    canvasText: '#f3ecf8',
    canvasDim: '#d0c2dc',
    bg: '#160f1f',
    panel: '#1d1428',
    panel2: '#2d2039',
    border: '#3c2c4c',
    text: '#f0e9f6',
    textDim: '#b7a9c6',
    accent: '#ec93d6',
    accentFg: '#2a0f25',
    danger: '#ff8f96',
    success: '#8fe0b0',
    warn: '#f5cf74',
    syntax: { keyword: '#ec93d6', string: '#b6e08c', number: '#ffb38a', comment: '#94849f', func: '#a3b4ff', type: '#f0c98a' },
    ansi: darkAnsi('#a3b4ff', '#ec93d6', '#8fd8e0'),
  },
  {
    id: 'neve',
    label: 'Neve',
    kind: 'light',
    canvas: '#c9d8f0',
    canvasText: '#1a2233',
    canvasDim: '#404a5e',
    bg: '#ffffff',
    panel: '#f7f9fc',
    panel2: '#e9edf5',
    border: '#d8dfea',
    text: '#1a2233',
    textDim: '#566074',
    accent: '#2c5be0',
    accentFg: '#ffffff',
    danger: '#c0302a',
    success: '#1f7a3d',
    warn: '#8a5a00',
    syntax: { keyword: '#6d3fd0', string: '#1f7a3d', number: '#b3491e', comment: '#667086', func: '#2c5be0', type: '#0f7388' },
    ansi: lightAnsi('#2c5be0', '#6d3fd0', '#0f7388'),
  },
  {
    id: 'sabbia',
    label: 'Sabbia',
    kind: 'light',
    canvas: '#e6cfae',
    canvasText: '#2b2218',
    canvasDim: '#524434',
    bg: '#fffdf9',
    panel: '#faf5ec',
    panel2: '#f0e7d7',
    border: '#e2d5c0',
    text: '#2b2218',
    textDim: '#695a48',
    accent: '#b0431a',
    accentFg: '#ffffff',
    danger: '#b3261e',
    success: '#3e7a2a',
    warn: '#8a5a00',
    syntax: { keyword: '#b0431a', string: '#3e7a2a', number: '#8c3fa0', comment: '#7a6b58', func: '#1f5f9c', type: '#7a5a00' },
    ansi: lightAnsi('#1f5f9c', '#8c3fa0', '#17757a'),
  },
];

export const DEFAULT_THEME = 'grafite';

let userThemes: Theme[] = [];

/** Themes from extensions.json, on top of the built-in ones. */
export function setUserThemes(themes: Theme[]): void {
  userThemes = themes;
}

/** Unknown ids, including the old `ideal-dark`, land on the default. */
export function resolveTheme(id: string | null | undefined): Theme {
  return [...THEMES, ...userThemes].find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

const alpha = (hex: string, a: number) =>
  `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** CSS custom properties for a theme. */
export function themeVars(t: Theme): Record<string, string> {
  const dark = t.kind === 'dark';
  return {
    '--canvas': t.canvas,
    '--canvas-text': t.canvasText,
    '--canvas-dim': t.canvasDim,
    '--bg': t.bg,
    '--panel': t.panel,
    '--panel-2': t.panel2,
    '--border': t.border,
    '--text': t.text,
    '--text-dim': t.textDim,
    '--accent': t.accent,
    '--accent-fg': t.accentFg,
    '--accent-soft': alpha(t.accent, dark ? 0.18 : 0.14),
    '--danger': t.danger,
    '--success': t.success,
    '--warn': t.warn,
    '--syn-keyword': t.syntax.keyword,
    '--syn-string': t.syntax.string,
    '--syn-number': t.syntax.number,
    '--syn-comment': t.syntax.comment,
    '--syn-func': t.syntax.func,
    '--syn-type': t.syntax.type,
    '--shadow-block': dark ? '0 1px 2px #0000004d, 0 4px 14px #00000033' : '0 1px 2px #1a22331a, 0 4px 14px #1a223314',
    '--shadow-pop': dark ? '0 12px 40px #00000080' : '0 12px 40px #1a223333',
  };
}

export function xtermTheme(t: Theme) {
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = t.ansi;
  return {
    background: t.bg,
    foreground: t.text,
    cursor: t.accent,
    cursorAccent: t.bg,
    selectionBackground: alpha(t.accent, 0.3),
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
  };
}

/** Sets the theme on the document; everything but xterm follows through CSS variables. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  root.dataset.theme = t.id;
  root.style.colorScheme = t.kind;
}
