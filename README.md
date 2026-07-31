# Native Artifact

[![npm version](https://img.shields.io/npm/v/@baaqar/artifact-to-pwa)](https://www.npmjs.com/package/@baaqar/artifact-to-pwa)
[![npm downloads](https://img.shields.io/npm/dw/@baaqar/artifact-to-pwa)](https://www.npmjs.com/package/@baaqar/artifact-to-pwa)
[![license](https://img.shields.io/npm/l/@baaqar/artifact-to-pwa)](./LICENSE)
[![node](https://img.shields.io/node/v/@baaqar/artifact-to-pwa)](https://nodejs.org)

> Convert any Claude artifact (.jsx / .html) into a **native Windows .exe** — no Rust, no compiler, no App Store.

## Usage

```bash
npx artifact-to-pwa ./my-app.jsx
npx artifact-to-pwa ./app.html --name "My Tool"
npx artifact-to-pwa ./app.jsx  --name "My Tool" --icon ./icon.png
```

**To get your artifact file from Claude:**
Open the artifact → click the `<>` source button → save as `.jsx` or `.html`

First run downloads the Neutralino binary (~4 MB, cached permanently). Subsequent builds finish in under a second.

## Output

```
my-tool-windows/          ← ~5 MB total
├── My Tool.exe           ← double-click to launch
├── neutralino.config.json
├── resources/
│   ├── index.html
│   └── js/
│       └── neutralino.js
└── README-Launch.txt
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name` | App name | From filename |
| `-c, --color` | Theme color | `#6366f1` |
| `-i, --icon` | `.png` icon | Default |
| `-o, --out` | Output directory | `./<slug>-windows` |

## Persistent storage

`localStorage` persists natively via **WebView2's built-in profile storage** at `%LOCALAPPDATA%\com.artifact-to-pwa.<slug>\EBWebView\`. No shim. No IPC bridge. It just works.

## Requirements

**WebView2 runtime** (pre-installed on Windows 11 and Windows 10 updated after Jan 2023).
If missing: https://developer.microsoft.com/microsoft-edge/webview2/

## Why Neutralino instead of Electron

| | Electron | Neutralino |
|--|----------|------------|
| Output size | ~350 MB | ~5 MB |
| Download | ~85 MB at install | ~4 MB on first build |
| localStorage | Required IPC shim | Native — just works |
| Runtime | Bundled Chromium | OS WebView2 |

## Changelog

### v3.0.0
- Switched from Electron to Neutralino (70x smaller output)
- localStorage persistence fixed — WebView2 stores natively, no shim
- Dynamic binary fetching — never bundled in npm package
- Removed `extract-zip` and Electron template files

### v2.1.0 — Fix #1–5: URL deprecation, clean output, storage IPC fix, React import crash, error handling
### v2.0.1 — esbuild CORS patch
### v2.0.0 — Native Windows .exe via Electron
### v1.1.0 — localStorage → IndexedDB shim
### v1.0.0 — Initial release

---
Made to keep Claude artifacts alive outside the chat.
