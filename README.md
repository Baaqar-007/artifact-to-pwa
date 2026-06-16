# artifact-to-pwa

> Convert any Claude artifact (HTML / React / JSX) or public URL into an installable Progressive Web App — no build step, no Android Studio, no Xcode.

[![npm version](https://img.shields.io/npm/v/artifact-to-pwa)](https://www.npmjs.com/package/artifact-to-pwa)
[![npm downloads](https://img.shields.io/npm/dw/artifact-to-pwa)](https://www.npmjs.com/package/artifact-to-pwa)
[![license](https://img.shields.io/npm/l/artifact-to-pwa)](./LICENSE)
[![node](https://img.shields.io/node/v/artifact-to-pwa)](https://nodejs.org)

## Usage

```bash
# From a local file
npx artifact-to-pwa ./my-app.jsx

# From a published Claude artifact URL
npx artifact-to-pwa https://claude.site/artifacts/abc123

# With options
npx artifact-to-pwa ./app.html --name "My Tool" --color "#ff6b6b" --out ./dist
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name <name>` | App name | Derived from filename / URL |
| `-s, --short-name <name>` | Home screen label (max ~12 chars) | First 12 chars of name |
| `-d, --description <text>` | App description | |
| `-c, --color <hex>` | Theme / accent color | `#6366f1` |
| `-b, --bg <hex>` | Splash background color | `#ffffff` |
| `-o, --out <dir>` | Output directory | `./<slug>-pwa` |

## What it generates

```
my-app-pwa/
├── index.html    ← your app, PWA-ready
├── manifest.json ← name, icon, colors, display mode
├── sw.js         ← service worker (offline support)
├── icon.svg      ← auto-generated app icon
└── README.md     ← install instructions
```

## Persistent storage — automatic localStorage migration

Artifacts that use `localStorage` (todo lists, streak trackers, heatmaps, settings)
will have their data automatically migrated to **IndexedDB** when converted.

No code changes needed. The tool detects `localStorage` usage and injects a
transparent shim that:

- keeps the exact same `localStorage` API your artifact already uses
- stores all data in IndexedDB instead, which persists across PWA installs and updates
- pre-populates an in-memory mirror on load so reads stay synchronous
- briefly hides the page on startup until saved data is ready — preventing a flash of empty state

You'll see this in the CLI output when it applies:

```
  ⚡ localStorage detected → auto-migrating to IndexedDB
```

## How to install the PWA

### Desktop / Android (Chrome or Edge)
```bash
npx serve my-app-pwa
```
Open the URL → click the **Install** icon in the address bar.

### iPhone / iPad (Safari)
Deploy the folder anywhere static (see below), open in Safari → **Share** → **Add to Home Screen**.

### One-click deploy options

| Host | Command |
|------|---------|
| **Netlify** | Drag the folder to [netlify.com/drop](https://netlify.com/drop) |
| **Vercel** | `npx vercel my-app-pwa` |
| **GitHub Pages** | Push folder contents, enable Pages in repo settings |

## Supported source formats

| Format | Detection |
|--------|-----------|
| Full HTML document | `<!DOCTYPE html>` or `<html>` present |
| HTML fragment | Partial markup without doctype |
| React / JSX | `import React`, `useState`, `export default function`, JSX syntax |
| Public URL | Embedded as a full-screen iframe |

React artifacts are served using Babel standalone + CDN React — **no bundler needed**.

## Why PWA instead of APK?

- **Zero build tooling** — no Android Studio, no Xcode, no Java
- **Cross-platform** — installs on Android, iOS, Windows, macOS, Linux
- **Always up to date** — users get the latest version automatically
- **Offline support** — built-in service worker caches assets

---

Made with ❤️ to keep Claude artifacts alive outside the chat.
