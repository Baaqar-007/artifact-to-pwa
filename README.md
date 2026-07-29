# Native Artifact

[![npm version](https://img.shields.io/npm/v/artifact-to-pwa)](https://www.npmjs.com/package/@baaqar/artifact-to-pwa)
[![npm downloads](https://img.shields.io/npm/dw/artifact-to-pwa)](https://www.npmjs.com/package/@baaqar/artifact-to-pwa)
[![license](https://img.shields.io/npm/l/artifact-to-pwa)](./LICENSE)
[![node](https://img.shields.io/node/v/artifact-to-pwa)](https://nodejs.org)

> Convert any Claude artifact (HTML / React / JSX) or public URL into a **native Windows .exe** — no Rust, no compiler, no App Store. (Note: The tool now generates native desktop apps to guarantee offline storage, retaining the artifact-to-pwa name for legacy continuity).

## Usage

```bash
npx artifact-to-pwa ./my-app.jsx
npx artifact-to-pwa https://claude.site/artifacts/abc123
npx artifact-to-pwa ./app.jsx --name "My Tool" --icon ./icon.png
```

First run downloads a prebuilt Electron shell (~85 MB, cached permanently). Subsequent builds finish in under a second.

## Output

```
my-tool-windows/
├── My Tool.exe          ← double-click to launch
├── *.dll / *.pak        ← Electron runtime (required)
├── resources/app/       ← your artifact
└── README-Launch.txt    ← SmartScreen bypass instructions
```

To share: **zip the entire folder** and send it.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name` | App name | From filename/URL |
| `-c, --color` | Theme color | `#6366f1` |
| `-i, --icon` | `.png` icon path | Electron default |
| `-o, --out` | Output directory | `./<slug>-windows` |

## Persistent storage

All `localStorage` calls are intercepted and persisted to `%APPDATA%\<AppName>\storage.json`. Survives restarts, re-installs, and OS reboots. Zero code changes needed in your artifact.

## Launching on Windows

The `.exe` is unsigned. On first launch click **More info → Run anyway**. Full instructions are in `README-Launch.txt`.

## Changelog

### v2.0.0
- Native Windows `.exe` via prebuilt Electron binary injection
- esbuild bundler — fully offline at runtime, no Babel CDN
- Atomic file-system storage via Electron IPC
- Ephemeral npm install for third-party dependencies
- Icon support via `--icon` (PNG → ICO + rcedit)

### v1.1.0 — localStorage → IndexedDB shim
### v1.0.0 — Initial release (PWA folder output)

---
Made to keep Claude artifacts alive outside the chat.
