import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { showToast } from '../ui/toast.svelte';
import { applyPayload, DEFAULT_SETTINGS, WARNING_TEXT, type Settings, type SettingsPayload } from './model';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class SettingsStore {
  value = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
  /** True once the first get_settings finished (or failed, falling back to defaults). */
  ready = $state(false);
  #started = false;

  #apply(p: SettingsPayload | null) {
    const { settings, toast } = applyPayload(p);
    // Replace only changed sections so effects reading other sections don't rerun.
    const v = this.value as unknown as Record<string, unknown>;
    for (const k of Object.keys(settings) as (keyof Settings)[]) {
      if (!same(v[k], settings[k])) v[k] = settings[k];
    }
    if (toast) showToast(toast);
  }

  /** Load once, then follow settings://changed. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      await listen<SettingsPayload>('settings://changed', (e) => this.#apply(e.payload));
    } catch (e) {
      console.warn('settings listen failed', e);
    }
    try {
      this.#apply(await invoke<SettingsPayload>('get_settings'));
    } catch (e) {
      console.warn('settings init failed', e);
      this.#apply({ settings: {}, warning: WARNING_TEXT });
    }
    this.ready = true;
  }

  /** Applies at once, then persists; the file watcher confirms it for other windows. */
  async setTheme(id: string): Promise<void> {
    this.value.theme = id;
    try {
      await invoke('set_theme', { theme: id });
    } catch (e) {
      showToast(`Tema non salvato: ${e}`);
    }
  }
}

export const settings = new SettingsStore();


export const settingsPath = () => invoke<string>('settings_path');
