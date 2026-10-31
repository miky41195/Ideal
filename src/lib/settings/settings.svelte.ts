import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { showToast } from '../ui/toast.svelte';
import { applyPayload, DEFAULT_SETTINGS, type Settings, type SettingsPayload } from './model';

class SettingsStore {
  value = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
  #started = false;

  #apply(p: SettingsPayload | null) {
    const { settings, toast } = applyPayload(p);
    this.value = settings;
    if (toast) showToast(toast);
  }

  /** Load once, then follow settings://changed. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      await listen<SettingsPayload>('settings://changed', (e) => this.#apply(e.payload));
      this.#apply(await invoke<SettingsPayload>('get_settings'));
    } catch (e) {
      console.warn('settings init failed', e);
    }
  }
}

export const settings = new SettingsStore();

export const settingsPath = () => invoke<string>('settings_path');
