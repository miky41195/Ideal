# Ideal

A lightweight personal IDE for Windows, built around the Claude Code CLI: real `claude` sessions sit at the center, and a full editor is one `Ctrl+Shift+E` away.

Built with Tauri 2 + WebView2, Svelte 5, CodeMirror 6 and xterm.js.

## Features

- **Claude sessions** in real terminals (PTY), with tabs, resume, context size readout and a "Claude is waiting" notification
- **Editor**: CodeMirror 6 with language servers (LSP: completion, hover, go to definition, rename, diagnostics), minimap, split view, project-wide search and replace, quick open, command palette
- **Hot exit**: unsaved edits survive closing the window; changes made on disk (e.g. by Claude) show a reload / keep mine / compare banner
- **Git panel**: stage, commit, branches, fetch / pull / push, side-by-side diffs, commit heatmap
- **Claude Hub**: past sessions and transcripts, claude-mem observations, memories, project docs
- **Dock layout**: drag, split and add blocks (terminals, editors, web preview, package.json scripts)
- **Settings as JSON** in `%APPDATA%/Ideal/` (`settings.json`, `keybindings.json`, `extensions.json` for themes, snippets and commands), reloaded live
- **Automatic updates**: a banner offers each new release with "Update now" or "Later"

## Install

Download `Ideal_<version>_x64-setup.exe` from the [latest release](https://github.com/miky41195/Ideal/releases/latest) and run it.

Requirements: Windows 11 (WebView2 runtime is included), and the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`) on your PATH.

Ideal checks for a new release at every start. "Update now" downloads it, backs up unsaved edits, installs it and reopens Ideal; "Later" hides the banner until the next start.

## Development

Prerequisites: Node 20, Rust 1.91+, PowerShell 7 (for the RAM script).

```
npm install
npm run tauri dev            # development
npm run tauri build          # release build + NSIS installer
npm test                     # frontend tests (Vitest)
cd src-tauri && cargo test   # Rust tests
pwsh scripts/measure-ram.ps1 # RAM of Ideal and its children (private working set; budget: total < 250 MB, main < 50 MB)
```

## Releasing an update

1. Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`.
2. Run `node scripts/release.mjs "What changed"`.

The script builds an installer signed with the updater key (`~/.tauri/ideal.key`, never committed), writes `latest.json` and publishes a GitHub release. Installed copies read `latest.json` from the latest release and verify the signature before installing. Losing the key means installed copies can no longer be updated automatically.
