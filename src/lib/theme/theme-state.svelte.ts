import { settings } from '../settings/settings.svelte';
import { resolveTheme, type Theme } from './themes';

/** The theme on screen: a hovered preview if any, else the saved one. Everything reads this, terminals included. */
class ThemeState {
  preview = $state<string | null>(null);

  get theme(): Theme {
    return resolveTheme(this.preview ?? settings.value.theme);
  }
}

export const themeState = new ThemeState();
