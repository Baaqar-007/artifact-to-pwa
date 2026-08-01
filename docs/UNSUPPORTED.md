# Unsupported Features

artifact-to-pwa bundles Claude artifacts into a **browser/WebView2 environment**.
This means anything that requires a Node.js server, native OS APIs, or a build pipeline
is not supported out of the box.

---

## Node.js Built-in Modules

The following Node.js core modules cannot run in a browser context and will cause the
build to fail with a clear error message:

```
fs  path  os  crypto  http  https  net  dns  child_process
cluster  worker_threads  stream  readline  events  util
assert  buffer  querystring  url  zlib  tls  module  process
v8  vm  perf_hooks  async_hooks  inspector  repl
```

**Why:** These modules access the OS (filesystem, network, processes) and have no
browser equivalent.

**Alternative:** If you need filesystem access, use the Neutralino API:
```javascript
// Instead of: fs.writeFileSync('data.json', content)
await Neutralino.filesystem.writeFile('data.json', content);
```

Neutralino APIs are available on `window.Neutralino` after the app launches.
See https://neutralino.js.org/docs/api/overview

---

## Server Frameworks

| Package | Reason |
|---------|--------|
| `express` | Node.js HTTP server — requires Node runtime |
| `koa` | Node.js HTTP server — requires Node runtime |
| `fastify` | Node.js HTTP server — requires Node runtime |
| `hapi` | Node.js HTTP server — requires Node runtime |

These packages spin up an HTTP server and cannot run in a WebView.

---

## Full-stack / Meta-frameworks

| Package | Reason |
|---------|--------|
| `next` | Requires Node.js server for SSR/ISR |
| `@remix-run/react` | Requires Node.js server for loaders/actions |
| `gatsby` | Requires a Node.js build pipeline at runtime |
| `nuxt` | Requires a Node.js server |
| `sveltekit` | Requires a Node.js server |

**Alternative:** Extract the client-only part of your component and convert that.
React components that don't use server features (API routes, SSR, data loaders)
will usually bundle correctly.

---

## Build Tools (not runtime dependencies)

| Package | Reason |
|---------|--------|
| `vite` | A build tool, not a runtime library |
| `webpack` | A build tool, not a runtime library |
| `rollup` | A build tool, not a runtime library |
| `parcel` | A build tool, not a runtime library |

If your artifact imports these, they are likely imported by mistake.
Remove the import — your artifact won't use them at runtime.

---

## Electron APIs

| Import | Reason |
|--------|--------|
| `electron` | Electron APIs don't exist in Neutralino |
| `ipcRenderer` | Electron-specific IPC |
| `contextBridge` | Electron-specific API |

**Alternative:** Use Neutralino's equivalents:
```javascript
// Instead of: ipcRenderer.send('key', value)
await Neutralino.storage.setData('key', value);
```

---

## Dynamic Imports with Variables

```javascript
// NOT supported:
const mod = await import(`./plugins/${name}`);
```

esbuild cannot statically analyse dynamic import paths with runtime variables.
Replace with a static map:

```javascript
const PLUGINS = {
  chart: () => import('./plugins/chart.jsx'),
  table: () => import('./plugins/table.jsx'),
};
const mod = await PLUGINS[name]();
```

---

## React.lazy with network URLs

```javascript
// NOT supported:
const Comp = React.lazy(() => import('https://cdn.example.com/comp.js'));
```

All imports must be resolvable at build time from npm or local files.

---

## Large Artifacts

Artifacts above ~5 MB of source code (before bundling) may cause esbuild to time out
or produce very large output files that load slowly in WebView2. Consider splitting
large artifacts into separate apps.

---

## CSS Modules

```javascript
import styles from './App.module.css';
```

CSS modules are partially supported: the CSS is bundled as a plain string, not
processed with class name hashing. Use Tailwind or inline styles for reliable styling.

---

## Features That Work Fine

For reference, these patterns are **fully supported**:

- ✅ React hooks (`useState`, `useEffect`, `useContext`, `useRef`, etc.)
- ✅ React.lazy + Suspense (with static import paths)
- ✅ Tailwind CSS (via CDN injection in the HTML)
- ✅ Third-party npm packages (recharts, lodash, date-fns, zod, etc.)
- ✅ SVG and image imports (converted to data URLs)
- ✅ CSS imports (inlined as strings)
- ✅ `localStorage` (persists natively via WebView2 profile)
- ✅ `fetch()` API
- ✅ Canvas and WebGL
- ✅ File input (`<input type="file">`)
- ✅ Web Workers (URL-based, not module workers)
- ✅ IndexedDB
- ✅ WebSockets (to external servers)
- ✅ TypeScript and TSX

---

If you hit an unsupported pattern not listed here, please open an issue at:
https://github.com/Baaqar-007/artifact-to-pwa/issues
