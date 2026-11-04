import { mount } from 'svelte';
import App from './App.svelte';
import { applyTheme, resolveTheme } from './lib/theme/themes';

// Cached id avoids a flash of the default theme while settings.json loads.
try {
  applyTheme(resolveTheme(localStorage.getItem('ideal.theme')));
} catch {
  applyTheme(resolveTheme(null));
}

const app = mount(App, { target: document.getElementById('app')! });

export default app;
