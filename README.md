# artifact-to-pwa

> Turn any Claude artifact (HTML / React / JSX) or public URL into a **single self-contained HTML file**.
> Open by double-click. No server. No folder of files. No build step.

## Usage

```bash
# From a local artifact file
npx artifact-to-pwa ./my-app.jsx

# From a published Claude artifact URL
npx artifact-to-pwa https://claude.site/artifacts/abc123

# With options
npx artifact-to-pwa ./app.html --name "My Tool" --color "#ff6b6b"
```

## Output

A single `my-tool.html` file you can:

- **Open** by double-clicking (works in Chrome, Edge, Firefox)
- **Share** by attaching the file to an email or message
- **Host** by dropping it onto any static web server
- **Back up** alongside the data it saves

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name <name>` | App name | Derived from filename or URL |
| `-c, --color <hex>` | Theme color | `#6366f1` |
| `-o, --out <file>` | Output filename | `./<slug>.html` |

## Supported source formats

| Format | Detected by |
|--------|-------------|
| Full HTML document | `<!DOCTYPE html>` or `<html>` |
| HTML fragment | Partial markup |
| React / JSX | `import React`, `useState`, `export default function`, JSX syntax |
| Public URL | Fetched at build time and inlined — no iframe |

React artifacts are bundled with Babel standalone + CDN React. An internet connection
is needed the first time the file opens (to load those scripts), but the app itself
works offline after that.

## Persistent storage

Artifacts that save data (todo lists, streaks, settings, heatmaps) use `localStorage`,
which works fine when opening a local HTML file.

If you **move or rename the file**, localStorage resets because it is tied to the file path.
To handle this, a small **💾 Export / 📂 Import** widget is automatically injected
into any app that uses localStorage:

- **💾 Export** — downloads all saved data as `app-data.json`
- **📂 Import** — restores from a previously exported file (reloads the app)

Your data stays in plain readable JSON. No hidden databases.

## Why not a folder / PWA install?

v1 generated a folder of files (index.html + manifest + service worker + icon).
In practice this created friction: users had to serve the folder over HTTP just
to open it, the URL mode silently 404d due to iframe blocking, and output files
were sometimes empty due to an import chain bug.

v2 outputs a single file that just works. PWA install (home screen icon, offline
caching) requires HTTPS hosting anyway — if you need that, drop the `.html` file
onto [netlify.com/drop](https://netlify.com/drop) and use the resulting URL.

## Changelog

### v2.0.0
- **Single file output** — `app.html` instead of a folder
- **URL mode fixed** — content fetched at build time and inlined (no iframe)
- **Empty file bug fixed** — explicit validation at every stage with clear errors
- **Storage widget** — replaces broken IndexedDB shim with simple export/import UI
- **Removed:** manifest, service worker, icon generation

### v1.1.0
- Auto localStorage to IndexedDB migration shim

### v1.0.0
- Initial release

---

Made to keep Claude artifacts alive outside the chat.
