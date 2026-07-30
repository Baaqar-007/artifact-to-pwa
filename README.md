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

## Output

```
my-tool-windows/
├── Start My Tool.bat    ← double-click to launch
├── README-Launch.txt
└── _internal/           ← Electron runtime (do not delete)
    ├── My Tool.exe
    ├── *.dll / *.pak
    └── resources/app/
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name` | App name | From filename |
| `-c, --color` | Theme color | `#6366f1` |
| `-i, --icon` | `.png` icon | Electron default |
| `-o, --out` | Output directory | `./<slug>-windows` |

## Persistent storage

All `localStorage` calls are persisted to `%APPDATA%\<AppName>\storage.json`. Data survives restarts, reinstalls, and reboots. Zero code changes needed.

## Changelog

### v2.1.0
- Fix #1 — URL input deprecated (Anthropic blocks scraping via X-Frame-Options)
- Fix #2 — Clean output: Electron internals moved to `_internal/`, batch launcher at root
- Fix #3 — Storage persistence: IPC handlers registered before window creation
- Fix #4 — React import crash: comprehensive stripping of all import variants
- Fix #5 — Error handling: ora spinners, global try/catch, proper exit codes
- Dep: esbuild `^0.25.0`

### v2.0.1 — esbuild CORS patch
### v2.0.0 — Native Windows .exe via Electron injection
### v1.1.0 — localStorage → IndexedDB shim
### v1.0.0 — Initial release

---
Made to keep Claude artifacts alive outside the chat.
