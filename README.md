# Native Artifact

[![npm version](https://img.shields.io/npm/v/@baaqar/artifact-to-pwa)](https://www.npmjs.com/package/@baaqar/artifact-to-pwa)
[![npm downloads](https://img.shields.io/npm/dw/@baaqar/artifact-to-pwa)](https://www.npmjs.com/package/@baaqar/artifact-to-pwa)
[![license](https://img.shields.io/npm/l/@baaqar/artifact-to-pwa)](./LICENSE)
[![node](https://img.shields.io/node/v/@baaqar/artifact-to-pwa)](https://nodejs.org)

> Convert any Claude artifact (.jsx / .html) into a native desktop application.
> ~5 MB output. No compiler. No App Store. No manual setup.

```bash
npx artifact-to-pwa ./my-app.jsx --name "My Tool"
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [How to Get Your Artifact File](#how-to-get-your-artifact-file)
- [Options](#options)
- [Output Structure](#output-structure)
- [How It Works](#how-it-works)
- [Claude Runtime Compatibility](#claude-runtime-compatibility)
- [Persistent Storage](#persistent-storage)
- [Supported and Unsupported Features](#supported-and-unsupported-features)
- [Build History](#build-history)
- [Architecture Reference](#architecture-reference)
- [Changelog](#changelog)

---

## Quick Start

```bash
# Convert a local artifact file
npx artifact-to-pwa ./my-app.jsx

# With a custom name and icon
npx artifact-to-pwa ./app.jsx --name "My Tool" --icon ./icon.png
```

On first run the tool downloads the Neutralino runtime (~4 MB) and caches it
permanently. Subsequent builds finish in under a second.

**Requirements:**
- Node.js 18 or later
- Windows 10 (updated after January 2023) or Windows 11
- Linux: Ubuntu 20.04+, Fedora 36+, or Arch with WebKitGTK installed
- Internet connection on first build only

---

## How to Get Your Artifact File

Claude does not allow direct URL scraping (Anthropic enforces `X-Frame-Options`
headers on all artifact URLs). The correct workflow is:

1. Open your artifact in Claude
2. Click the **`<>`** source code button in the artifact toolbar
3. Copy the code and save it as `my-app.jsx` or `my-app.html`
4. Run `npx artifact-to-pwa ./my-app.jsx`

---

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name <name>` | App name shown in the title bar and taskbar | Derived from filename |
| `-c, --color <hex>` | Theme color written into the Neutralino config | `#6366f1` |
| `-i, --icon <path>` | Path to a `.png` icon (converted to `.ico` and patched into the exe) | Electron default |
| `-o, --out <dir>` | Output directory | `./<slug>-windows` |

---

## Output Structure

```
my-tool-windows/          (~5 MB total)
├── My Tool.exe           ← double-click to launch
├── neutralino.config.json
├── resources/
│   ├── index.html        ← your bundled artifact
│   └── js/
│       └── neutralino.js ← Neutralino client bridge
└── README-Launch.txt     ← SmartScreen bypass instructions
```
```
my-tool-linux/
├── My Tool          ← run this (or start.sh)
├── start.sh         ← convenience launcher
├── neutralino.config.json
├── resources/
│   ├── index.html
│   └── js/neutralino.js
└── README-Launch.txt
```

To share the app: **zip the entire folder** and send it.
The recipient needs WebView2 installed (see below).

**Launching on Windows:**
The `.exe` is unsigned. On first launch Windows SmartScreen shows a warning.
Click **More info → Run anyway**. This appears once per machine.

---

## How It Works

The tool has three pipeline stages that run in sequence.

### Stage 1 — Bundle

The artifact source file is read and classified into one of three types:

- **Full HTML** (`<!DOCTYPE html>` or `<html>` present): passed through with
  the Claude compatibility shims and Neutralino bridge injected into `<head>`.
- **HTML fragment** (partial markup): wrapped in a complete shell document,
  then same injection as above.
- **React / JSX** (detected by import patterns and JSX syntax): processed
  through esbuild. React imports are stripped first (they are re-provided by
  the entry wrapper), third-party dependencies are installed into a
  hash-keyed local cache, and the result is a single self-contained HTML file
  with the bundled JavaScript inlined.

The entry file for esbuild is written **beside the artifact** (same directory),
not in `os.tmpdir()`. This is critical: esbuild resolves relative imports like
`./styles.css` and `./icon.png` relative to the entry file's location.
Writing the entry to a temp directory breaks all relative imports silently.

### Stage 2 — Runtime

The Neutralino binary and client library are fetched from the official GitHub
Releases API if not already cached. Both files are downloaded in parallel.
SHA-256 integrity is verified using the `digest` field from the GitHub releases
API response. The cache self-heals: if a cached file fails verification it is
deleted and re-downloaded automatically.

Details of the download pipeline:

- Asset URLs are resolved dynamically via the GitHub releases API `assets` array
  rather than hardcoded paths. This means the tool keeps working if Neutralino
  changes its asset naming between releases.
- `browser_download_url` is always used, never the `url` field. The `url` field
  is a GitHub API endpoint that returns JSON metadata unless an exact `Accept`
  header is sent. Using `browser_download_url` avoids this class of error.
- After downloading, a `Content-Type` guard rejects any response that contains
  `text/html` or `application/json` before the bytes reach disk.
- The progress bar clamps downloaded bytes against `Content-Length` before
  computing bar fill. Some servers report incorrect `Content-Length` values,
  which previously caused a negative `repeat()` call and a crash.

### Stage 3 — Inject

The bundled HTML and Neutralino runtime are assembled into the output directory:

1. The Neutralino binary is copied and renamed to `<AppName>.exe`.
2. `WebView2Loader.dll` is copied alongside the exe if present in the runtime ZIP.
3. `neutralino.config.json` is generated with a deterministic localhost port
   derived from the app slug (range 49152–65534). Each app gets its own port
   so their localStorage origins are isolated from each other.
4. The client library is copied to `resources/js/neutralino.js`.
5. The bundled `index.html` is written to `resources/`.
6. If `--icon` was provided, the PNG is converted to ICO and patched into the
   exe using `rcedit`.
7. `README-Launch.txt` is written with WebView2 download link and SmartScreen
   bypass instructions.

---

## Claude Runtime Compatibility

Claude exposes APIs on `window` that only exist inside its iframe environment.
When an artifact runs as a standalone app these APIs are absent, and any
artifact that calls them fails silently.

The tool automatically injects a compatibility layer (`src/runtime.js`) as the
first script on every generated page, before the Neutralino bridge and before
any app code. Each shim is guarded so it never overwrites Claude's native
implementation — the same HTML file works inside Claude (uses native APIs)
and as a standalone app (uses shims) without any modification.

### `window.storage`

The most common Claude-native API. Used by artifacts to persist data across
sessions inside Claude.

**Claude's contract:**

```javascript
await window.storage.set('key', 'value')     // → void
await window.storage.get('key')              // → { value: string } | null
await window.storage.remove('key')           // → void
await window.storage.clear()                 // → void
```

Note that `get()` returns `{ value: string }` or `null`, not a raw string.
Artifacts typically do:

```javascript
const result = await window.storage.get('key');
if (result) use(result.value);
```

**Shim implementation:**
Backed by `localStorage`, namespaced under the prefix `__cs__` to avoid
colliding with any direct `localStorage` usage in the same artifact.
All methods return resolved Promises so existing artifact code works unchanged.

### Adding future shims

When Claude introduces new runtime APIs, add them to `src/runtime.js`:

```javascript
const SHIM_WHATEVER = `
(function () {
  if (window.whatever) return;
  window.whatever = { ... };
}());`.trim();

const SHIMS = [
  SHIM_STORAGE,
  SHIM_WHATEVER,  // ← add here
];
```

The aggregate `CLAUDE_RUNTIME_SHIM` export is then automatically picked up
by `src/bundle.js` and injected everywhere.

---

## Persistent Storage

`localStorage` persists natively via WebView2's built-in profile storage.

WebView2 stores its data at:
```
%LocalAppData%\com.artifact-to-pwa.<slug>\EBWebView\Default\Local Storage\
```

This directory is created by WebView2 on first launch and survives app updates,
reinstalls, and reboots. No shim or IPC bridge is needed — `localStorage.setItem()`
in your artifact just works exactly as it does in a browser.

The port assigned to each app (derived deterministically from its slug) ensures
that `http://localhost:<port>` is a stable, consistent origin across every
launch. This is what WebView2 uses as the key for localStorage. Two apps with
different names get different ports and therefore different, isolated storage.

**WebView2 requirement:**
WebView2 is pre-installed on Windows 11 and on Windows 10 updated after
January 2023 (delivered via the Edge update channel). If it is missing, the
app will fail to open. The `README-Launch.txt` included in every generated
app links to the free 1.5 MB WebView2 Bootstrapper installer.

---

## Supported and Unsupported Features

### Works

- React hooks (`useState`, `useEffect`, `useContext`, `useRef`, etc.)
- `React.lazy` and `Suspense` with static import paths
- Tailwind CSS classes
- Third-party npm packages (`recharts`, `lodash`, `date-fns`, `zod`, etc.)
- SVG, PNG, JPG, GIF, WebP imports (converted to data URLs at build time)
- CSS imports (inlined as strings)
- Web fonts (`.woff`, `.woff2` converted to data URLs)
- `localStorage` and `sessionStorage`
- `window.storage` (Claude API — shimmed)
- `fetch()` to external APIs
- Canvas and WebGL
- `<input type="file">` file uploads
- IndexedDB
- WebSockets to external servers
- TypeScript and TSX
- Dynamic imports with static paths

### Does Not Work

**Node.js built-in modules** — `fs`, `path`, `os`, `crypto`, `http`, `https`,
`child_process`, and all other Node core modules cannot run in a WebView.
The build will fail with a human-readable error and a suggestion to use the
equivalent Neutralino API.

**Server frameworks** — Express, Koa, Fastify, and similar packages require
a Node.js process and have no browser equivalent.

**Meta-frameworks** — Next.js, Remix, Gatsby, and SvelteKit require a Node.js
server for SSR, ISR, or their data-fetching layers.

**Build tools as runtime dependencies** — Vite, Webpack, Rollup, and Parcel
are build tools. If your artifact imports them, that import should be removed.

**Electron APIs** — `ipcRenderer`, `contextBridge`, and other Electron-specific
APIs do not exist in a Neutralino app. Use `Neutralino.*` APIs instead.

**Dynamic imports with variable paths** — `import(\`./plugins/${name}\`)` cannot
be statically analysed by esbuild. Replace with a static map of lazy imports.

See `docs/UNSUPPORTED.md` in the repository for the full reference including
Neutralino API alternatives for each unsupported pattern.

---

## Build History

The tool went through several complete architectural rewrites. Each one was
driven by real problems found during testing or reported by users.
This section explains every decision in the order it was made.

---

### v1.0.0 — PWA Folder Output

**The idea:** the simplest way to make a Claude artifact installable outside
the chat is to wrap it as a Progressive Web App. A PWA is just a website with
three extra files: a `manifest.json` (tells the browser it is an app), a
service worker (`sw.js` for offline caching), and an icon. The browser then
offers an "Add to Home Screen" prompt.

**What it generated:**

```
my-app-pwa/
├── index.html
├── manifest.json
├── sw.js
├── icon-192.png
├── icon-512.png
└── README.md
```

**URL mode:** the tool also accepted a Claude artifact URL and embedded it in
a fullscreen `<iframe>`. This avoided the need to paste source code.

**How the React wrapping worked:** because Claude artifacts are often raw JSX
rather than complete HTML files, the tool detected the source type using regex
patterns and wrapped React/JSX files by injecting Babel standalone and CDN
React script tags. No local build step.

**What went wrong:**

- The iframe URL mode silently failed for all Claude artifact URLs because
  Anthropic enforces `X-Frame-Options: DENY` on artifact pages. The iframe
  would load a blank page with no error.
- The generated `index.html` was sometimes empty. The cause was an ESM import
  chain failure: `templates.js` imported `wrapCode` from `detect.js`, which
  had just been updated to import from `storage.js`. If any link in that chain
  resolved incorrectly the function returned `undefined`, and `writeFileSync`
  wrote that silently.
- PWA install requires HTTPS. Running the output folder locally with `npx serve`
  worked, but dragging it to Netlify Drop worked better. The UX friction of
  "serve a folder over HTTP just to see if your app works" was higher than expected.

---

### v1.1.0 — localStorage → IndexedDB Shim

**The problem reported:** a developer on dev.to pointed out that when an
artifact is converted and served from a new URL (e.g. deployed to Netlify),
its `localStorage` is empty. `localStorage` is keyed by origin (the page's
URL). Moving the file to a new URL means a new origin, which means a new,
empty `localStorage`. All saved data is lost.

**The fix:** inject a proxy object that intercepts every `localStorage` call
and routes it through IndexedDB instead. IndexedDB is also origin-scoped, but
we can control the key name and use a stable identifier.

**How the shim worked:**
- Replaced `window.localStorage` with a proxy object at page load.
- The proxy maintained an in-memory mirror for synchronous reads (IndexedDB is
  async; `localStorage.getItem()` is synchronous, so a true drop-in requires
  a pre-populated in-memory cache).
- On page load the shim read all IndexedDB data into the mirror, briefly hiding
  the page to prevent a flash of empty state, then revealed it once data was ready.
- On any `setItem` call, the mirror was updated synchronously and an async
  IndexedDB write was dispatched.

**The durability gap:** the shim was correct in normal operation but had a
theoretical data loss window. Between a `setItem()` call returning and the
IndexedDB write being flushed to disk, a hard crash could lose the last write.
For streak trackers and todo lists this was acceptable. For financial data it
would not be. This was documented and communicated to users.

**Result:** downloads jumped from ~80 to ~260 in a few days after the storage
addition. The shim addressed the most common real-world pain point.

---

### v2.0.0 — Native Windows .exe via Electron Binary Injection

**The problem with PWAs:** a PWA is still a website. Installing it requires
HTTPS hosting, a browser with PWA support, and the user understanding the
"Add to Home Screen" flow. Many users just wanted a file they could
double-click.

**The original architecture proposal:** use Tauri (Rust-based) to compile a
native binary. Tauri produces ~5 MB binaries and uses the OS webview, which
would have been ideal.

**Why Tauri was rejected for v2:** Tauri requires the Rust toolchain and
platform build tools on the user's machine. On Windows this means Visual Studio
Build Tools (~4 GB). First builds take 3–5 minutes. This is a fatal UX problem
for a tool that should produce an app in under a second.

**The chosen approach — binary injection:** instead of compiling anything
locally, download a pre-built Electron binary (~85 MB, cached permanently)
and inject the artifact into it. Electron ships as a directory of files.
The entry point is whatever is in `resources/app/`. By writing our own
`main.js`, `preload.js`, and `index.html` into that directory and renaming
`electron.exe` to `AppName.exe`, we get a native `.exe` with no local
compilation at all. Build time drops from minutes to milliseconds.

**The storage architecture:** Electron's renderer process (`index.html`) cannot
access the filesystem directly. Instead:
- A `preload.js` script exposes three IPC channels (`storage:set`,
  `storage:remove`, `storage:clear`) to the renderer via Electron's
  `contextBridge`.
- A `window.localStorage` proxy in the HTML intercepted all storage calls and
  routed writes through those IPC channels to the main process.
- The main process wrote data atomically to `%AppData%\<AppName>\storage.json`
  using a write-to-temp-then-rename pattern to prevent corruption.

**What actually shipped:** a ~350 MB output directory, which was the main
complaint. This was the known cost of bundling Chromium.

---

### v2.0.1 — esbuild CORS Patch

A CORS vulnerability in esbuild versions below `0.25.0` was forcing npm to
downgrade installations. The only change in this release was bumping the esbuild
dependency to `^0.25.0`.

---

### v2.1.0 — Five Targeted Fixes

Five issues were found and fixed simultaneously:

**Fix 1 — URL support deprecated.**
The URL fetch mode was formally removed. Anthropic's `X-Frame-Options` headers
block both iframe embedding and direct HTML scraping for all artifact URLs.
The headless browser alternative (Puppeteer) would have added ~150 MB of
browser binaries and still failed whenever Anthropic changed their auth flow.
The cost-to-benefit ratio was wrong. `fetchURL()` was replaced with a function
that immediately throws with exact instructions for downloading the file manually.

**Fix 2 — Clean output structure.**
The Electron output dumped 15+ DLL files alongside the exe at the root level,
which felt unprofessional. All Electron runtime files were moved into an
`_internal/` subdirectory. A batch launcher (`Start MyApp.bat`) at the root
level changed directory to `_internal/` before calling the exe.
The reason `_internal/` was necessary: the Electron binary must be in the same
directory as its DLLs (Windows PE loader requirement). Moving only the exe to
the root would make it fail to start. The batch launcher works around this.

**Fix 3 — Storage persistence bug.**
Data was not persisting across sessions. Two stacked bugs:
- The IPC handlers (`ipcMain.on('storage:set', ...)`) were registered *after*
  `createWindow()`. Any write from the renderer during first render arrived
  before the handler existed and was silently dropped. Fix: register handlers
  before creating the window.
- The temp file approach for HTML injection used the system temp directory.
  On some machines `%TEMP%` has restricted write access. Fix: use `userData`
  instead.

**Fix 4 — React import crash.**
esbuild was crashing with "Identifier already declared" on many Claude artifacts.
The entry wrapper added `import React from 'react'` but the artifact source
already contained React imports. The original regex only caught two forms.
Claude artifacts produce many more:
`import React, { useState } from 'react'`,
`import * as React from 'react'`,
`import ReactDOM from 'react-dom'`,
`import { createRoot } from 'react-dom/client'`, etc.
Fix: comprehensive stripping of all seven React/react-dom import forms before
passing code to esbuild.

**Fix 5 — Error handling.**
Raw Node.js stack traces were printed on failure, and some error paths exited
with code 0 (success). Fix: `ora` spinners for long operations, a global
`try/catch` wrapper in the build orchestrator, human-readable messages for
common esbuild and npm failures, and `process.exit(1)` on every error path.

---

### v3.0.0 — Neutralino Migration & Production Hardening

**The core problem with Electron:** a 350 MB output for a 5-page artifact with
a heatmap is objectively wrong. The artifact logic is ~50 KB. The Electron
runtime is ~300 MB because it bundles its own copy of Chromium and Node.js.
There is no configuration that meaningfully reduces this.

**The solution — Neutralino:** Neutralino is a lightweight framework that uses
the OS's built-in WebView instead of bundling one.

| | Electron | Neutralino |
|--|----------|------------|
| Output size | ~350 MB | ~5 MB |
| Runtime download | ~85 MB | ~4 MB |
| Storage shim | Required (IPC bridge) | Not needed |
| localStorage | Complex proxy via IPC | Native WebView2 persistence |

On Windows 10/11, Neutralino uses WebView2, which is part of Microsoft Edge
and pre-installed on all modern Windows machines. WebView2 stores localStorage
in a persistent profile directory tied to the `applicationId` in
`neutralino.config.json`. No shim, no IPC, no proxy — `localStorage.setItem()`
just works and persists forever.

**Why dynamic binary fetching:** the Neutralino binary is ~4 MB. Bundling it
inside the npm package would make `npm install artifact-to-pwa` download it for
every user on every platform, even users who never build for Windows. Instead
the binary is fetched on the first build and cached in `~/.artifact-to-pwa/`.

**The storage design change:** the entire Electron `main.js` / `preload.js` /
IPC architecture was deleted. `template/main.js` and `template/preload.js`
were removed from the repository. Storage now works without any intervention.

**The port design:** Neutralino serves the app at `http://localhost:<port>/`.
The port is derived deterministically from the app's slug using a hash function,
producing a number in the 49152–65534 range. This gives each app a stable,
consistent origin so localStorage is isolated between apps and persists
correctly across restarts.

**extract-zip removal and re-addition:** extract-zip was removed in v2.2.0
because the initial plan assumed Neutralino binaries were single files. When
the actual download was found to be a ZIP (in v3.0.0), extract-zip was added
back.

The architecture was correct but had several production issues discovered
during real-world testing.

**Bug 1 — HTTP 404 on binary download.**
The shell downloader tried to fetch `neutralino-win_x64.exe` directly from
the release URL. This file does not exist as a standalone asset. Neutralino
distributes all platform binaries inside a single `neutralino.zip` archive.
Additionally, the client library (`neutralino.js`) comes from a completely
separate repository (`neutralinojs/neutralino.js`), not from the main
`neutralinojs/neutralinojs` repo.

Fix: use the GitHub releases API `assets` array to locate correct URLs
dynamically rather than guessing filenames. Download `neutralino.zip`, extract
it, and copy the Windows-specific files. Download `neutralino.js` from the
correct second repo.

**Bug 2 — SHA-256 mismatch on every run after the first.**
After downloading and extracting, the code stored the ZIP file's GitHub API
digest as the expected hash for `neutralino-win_x64.exe`. On the next run it
computed the SHA-256 of the extracted exe and compared it against the ZIP's
hash. These are different files with different hashes. This comparison always
failed.

Fix: after extraction, compute and store the SHA-256 of the *extracted* exe
and client library. These are the files that will be verified on subsequent runs.

**Bug 3 — Wrong download URL.**
The code used `zipAsset.url || zipAsset.browser_download_url`. The `url` field
in a GitHub releases API response is an API endpoint
(`https://api.github.com/repos/.../releases/assets/<id>`) that returns JSON
metadata unless you send `Accept: application/octet-stream`. Without that
header it returns a 2 KB JSON object. The SHA-256 of that JSON object obviously
does not match the expected hash of the binary. The reported download size
(2 KB) was the diagnostic — a 4 MB binary cannot be 2 KB.

Fix: always use `browser_download_url` (direct CDN link, no headers needed).
Add a `Content-Type` guard that rejects `text/html` and `application/json`
responses before they reach disk.

**Bug 4 — Cache never self-healed.**
When integrity verification failed, the code threw an error telling the user
to manually delete `~/.artifact-to-pwa/neutralino/`. This is a bad user
experience for what is fundamentally a recoverable situation.

Fix: if verification fails, call `rmSync(cacheDir)` and fall through to the
download code. Only surface an error to the user if a freshly downloaded
runtime also fails verification (which would indicate a problem with the
upstream release itself).

**Bug 5 — CSS and image imports failing.**
When bundling a React artifact that imported `./styles.css` or `./icon.png`,
esbuild could not find those files. The reason: the temporary entry file was
written to `os.tmpdir()`. esbuild resolves relative imports relative to the
entry file's location. `os.tmpdir()` is a completely different directory from
the artifact. The files simply did not exist there.

Fix: write the entry file to `dirname(filePath)` — the same directory as the
artifact. Every relative import resolves correctly.

**Bug 6 — `window.storage` undefined.**
Some Claude artifacts use `window.storage`, a runtime API that Claude injects
into its iframe environment. This API does not exist anywhere else. When the
converted app called `window.storage.get(...)`, it got `undefined.get()` and
threw silently (caught internally by the artifact). Persistence appeared broken
when it was actually a missing API.

Fix: create `src/runtime.js` as a dedicated compatibility layer. It exports a
`CLAUDE_RUNTIME_SHIM` — a `<script>` block that is injected as the first
script on every generated page. The shim defines `window.storage` backed by
localStorage, namespaced under `__cs__` to avoid key collisions. It is guarded
so it never overwrites Claude's native implementation.

**Hardening — Version pinning.**
All `latest` version specifiers were replaced with pinned versions:
Neutralino `6.7.0` and React `18.3.1`. This prevents a Neutralino or React
breaking change from silently changing the behaviour of a future build.

**Hardening — detect.js module.**
React detection, import extraction, import stripping, and export normalisation
were extracted from `bundle.js` into their own `src/detect.js` module.
`extractBareImports()` was extended to recognise Node.js built-in modules and
known unsupported packages (Express, Electron, Next.js, etc.) and throw
human-readable errors with Neutralino API alternatives before esbuild runs.

**Hardening — Hash-based npm cache.**
The single global `npm-cache` directory was replaced with per-dependency-set
directories keyed by SHA-256 of the full dependency spec list. Different
artifacts with different third-party dependencies get isolated caches and
never interfere with each other.

**Compatibility test suite.**
`test/compat.test.js` uses Node's built-in `node:test` runner (no extra
framework, available since Node 18). It covers detection logic, unsupported
import error messages, and end-to-end bundling of representative artifact
patterns: simple React, Tailwind, localStorage usage, full HTML passthrough,
CSS imports, and image imports. Run with `npm test`.

### v3.0.1 - Linux compatibility

---

## Architecture Reference

```
npx artifact-to-pwa ./app.jsx --name "My App"
        │
        ▼
bin/cli.js              ← Commander parses flags, calls build()
        │
        ▼
src/build.js            ← Orchestrates the three stages
        │
        ├── Stage 1: Bundle ──────────────────────────────────────────────────
        │       │
        │       ├── src/detect.js       detectArtifactType()
        │       │                       extractBareImports()   (throws on Node builtins)
        │       │                       stripReactImports()
        │       │                       normaliseDefaultExport()
        │       │
        │       ├── src/bundle.js       installDeps()          (hash-keyed npm cache)
        │       │                       esbuild.build()        (entry beside artifact)
        │       │                       injectNeutralinoScript()
        │       │
        │       └── src/runtime.js      CLAUDE_RUNTIME_SHIM    (window.storage + future)
        │
        ├── Stage 2: Runtime ─────────────────────────────────────────────────
        │       │
        │       └── src/shell.js        fetchReleaseAssets()   (GitHub assets API)
        │                               downloadToFile()       (parallel, progress bar)
        │                               verifyDigest()         (SHA-256 via GitHub digest)
        │                               extractZip()
        │                               self-healing cache     (rmSync + re-download)
        │
        └── Stage 3: Inject ──────────────────────────────────────────────────
                │
                └── src/inject.js       portFromSlug()         (deterministic port)
                                        buildConfig()          (neutralino.config.json)
                                        rcedit()               (exe metadata + icon)
                                        launchReadme()
```

**File responsibilities:**

| File | Responsibility |
|------|---------------|
| `bin/cli.js` | CLI entry, flag parsing |
| `src/build.js` | Pipeline orchestration, error handling, output messages |
| `src/detect.js` | Artifact type detection, import analysis, React stripping |
| `src/bundle.js` | esbuild integration, npm dep management, HTML construction |
| `src/runtime.js` | Claude API compatibility shims |
| `src/shell.js` | Neutralino binary download, cache management, integrity |
| `src/inject.js` | Output directory assembly, config generation, exe patching |
| `src/fetch.js` | URL deprecation notice |
| `test/compat.test.js` | Compatibility test suite |
| `docs/UNSUPPORTED.md` | Unsupported feature reference |

---

## Changelog

### v3.0.0

- Switch from Electron to Neutralino — output drops from ~350 MB to ~5 MB
- localStorage persists natively via WebView2 profile (no shim needed)
- Dynamic binary fetching — Neutralino binary not bundled in npm package
- Removed `extract-zip`, `template/main.js`, `template/preload.js`
- Deterministic port-per-app for stable localStorage origin
- Fix: GitHub assets API used for download URL discovery (no more hardcoded filenames)
- Fix: binaries extracted from `neutralino.zip`, not downloaded as raw EXEs
- Fix: `browser_download_url` always used — `url` field returns JSON metadata
- Fix: SHA-256 stored for extracted files, not the ZIP (fixes perpetual cache mismatch)
- Fix: self-healing cache — corruption triggers automatic delete and re-download
- Fix: esbuild entry file written beside artifact (fixes CSS and image imports)
- Fix: `window.storage` Claude API compatibility shim injected on every page
- Feat: `src/runtime.js` — dedicated module for Claude API compatibility
- Feat: `src/detect.js` — separate module for React detection and import analysis
- Feat: human-readable errors for Node.js built-in and unsupported package imports
- Feat: hash-keyed npm dependency cache (isolated per dependency set)
- Harden: Neutralino pinned to v6.7.0, React pinned to 18.3.1
- Harden: `Content-Type` guard rejects HTML/JSON responses before they reach disk
- Harden: progress bar clamped to prevent crash on incorrect `Content-Length`
- Test: `test/compat.test.js` compatibility suite (Node built-in test runner)
- Docs: `docs/UNSUPPORTED.md` with Neutralino API alternatives



### v2.1.0
- URL input deprecated (Anthropic X-Frame-Options blocks all scraping)
- Output restructured: Electron internals in `_internal/`, batch launcher at root
- Storage persistence fixed: IPC handlers registered before window creation
- React import crash fixed: all seven React/react-dom import forms stripped
- Error handling: ora spinners, global try/catch, proper exit codes

### v2.0.1
- esbuild bumped to `^0.25.0` (CORS vulnerability patch)

### v2.0.0
- Native Windows `.exe` via prebuilt Electron binary injection
- Electron IPC bridge for localStorage persistence
- esbuild bundler replaces Babel CDN (offline at runtime)
- Ephemeral npm install for third-party artifact dependencies
- Icon support via `--icon` (PNG → ICO + rcedit)

### v1.1.0
- localStorage → IndexedDB shim (data persists when app is moved to new URL)
- ~260 downloads within a week of release

### v1.0.0
- Initial release: PWA folder output (manifest, service worker, icons)
- Auto-detection of HTML, HTML fragment, and React/JSX source types
- URL mode (later deprecated — blocked by X-Frame-Options)

---

Made to keep Claude artifacts alive outside the chat.
https://github.com/Baaqar-007/artifact-to-pwa