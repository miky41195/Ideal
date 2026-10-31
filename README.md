# Ideal

IDE personale leggera per Windows: Tauri 2 + WebView2, Svelte 5, CodeMirror 6, xterm.js.
Modalita Claude (sessioni `claude` in PTY) e modalita Editor, terminale integrato, settings in `%APPDATA%/Ideal/settings.json` con reload live.

## Prerequisiti

- Windows 11 con WebView2 runtime
- Node 20, Rust 1.91+, PowerShell 7 (per lo script RAM)
- Claude Code CLI (`claude`) nel PATH

## Comandi

```
npm install
npm run tauri dev        # sviluppo
npm run tauri build      # release + installer NSIS
npm test                 # test frontend (Vitest)
cd src-tauri && cargo test   # test Rust
pwsh scripts/measure-ram.ps1 # misura RAM di Ideal e figli (working set privato; budget: totale < 250 MB, main < 50 MB)
```
