import { settings } from '../settings/settings.svelte';
import { extensions } from '../extensions/extensions.svelte';
import { resolveTheme, type Theme } from './themes';

/** The theme on screen: a hovered preview if any, else the saved one. Everything reads this, terminals included. */
class ThemeState {
  preview = $state<string | null>(null);

  get theme(): Theme {
    void extensions.themes; // a user theme may load after the saved id is read
    return resolveTheme(this.preview ?? settings.value.theme);
  }
}

export const themeState = new ThemeState();
