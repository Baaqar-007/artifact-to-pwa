/**
 * Artifact type detection and React source processing — v3.0.0
 *
 * CHANGES FROM v2.x:
 *   Extracted from bundle.js into its own module (hardening item #8).
 *   Regex-based detection is acceptable for Claude artifacts which follow
 *   consistent patterns, but the module boundary makes it straightforward
 *   to swap in a proper AST parser (Babel/Acorn) later without touching
 *   the bundler.
 *
 *   Also: extractBareImports() now recognises Node.js built-in modules and
 *   raises a specific, actionable error when an artifact imports one. This
 *   replaces the generic "esbuild failed" message with a clear explanation
 *   of why the import is unsupported in a browser/WebView context.
 */

// ── Node.js built-ins that cannot run in a browser ────────────────────────────
// When an artifact imports any of these, we surface a human-readable error
// instead of letting esbuild crash with an opaque bundling failure.
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'dns',
  'child_process', 'cluster', 'worker_threads', 'stream', 'readline',
  'events', 'util', 'assert', 'buffer', 'querystring', 'url', 'zlib',
  'tls', 'module', 'process', 'v8', 'vm', 'perf_hooks', 'async_hooks',
  'inspector', 'repl', 'string_decoder', 'timers', 'punycode',
]);

// Packages that have no WebView equivalent — catch them early with good messages
const UNSUPPORTED_PACKAGES = new Map([
  ['express',    'Express is a Node.js server framework and cannot run in a desktop WebView.'],
  ['koa',        'Koa is a Node.js server framework and cannot run in a desktop WebView.'],
  ['fastify',    'Fastify is a Node.js server framework and cannot run in a desktop WebView.'],
  ['electron',   'Electron APIs are not available in a Neutralino app. Use Neutralino.* APIs instead.'],
  ['next',       'Next.js requires a Node.js server and cannot be bundled for desktop use.'],
  ['@remix-run', 'Remix requires a Node.js server and cannot be bundled for desktop use.'],
  ['gatsby',     'Gatsby requires a Node.js build pipeline and cannot be bundled directly.'],
  ['vite',       'Vite is a build tool, not a runtime dependency. Remove it from your artifact.'],
  ['webpack',    'Webpack is a build tool, not a runtime dependency. Remove it from your artifact.'],
]);

// ── Type detection ─────────────────────────────────────────────────────────────

/**
 * Classifies artifact source code into one of three categories.
 *
 * @param {string} code
 * @returns {'full-html' | 'react' | 'html-fragment'}
 */
export function detectArtifactType(code) {
  const t = code.trim();

  if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) {
    return 'full-html';
  }

  const reactSignals = [
    /from\s+['"]react['"]/,
    /export\s+default\s+function/,
    /export\s+default\s+class/,
    /useState\s*[(<]/,
    /useEffect\s*\(/,
    /return\s*\(\s*</,
    /<>\s*</,
  ];
  if (reactSignals.some(re => re.test(t))) return 'react';

  if (/^<[a-zA-Z]/.test(t)) return 'html-fragment';
  return 'html-fragment';
}

// ── Import extraction ──────────────────────────────────────────────────────────

/**
 * Extracts all bare (third-party) package specifiers from source code.
 * Raises descriptive errors for Node.js built-ins and known unsupported packages.
 *
 * @param {string} code
 * @returns {string[]} Array of package names (e.g. ["recharts", "lodash"])
 */
export function extractBareImports(code) {
  const patterns = [
    /from\s+['"]([^.'"\/][^'"]*)['"]/g,
    /require\s*\(\s*['"]([^.'"\/][^'"]*)['"]\s*\)/g,
  ];

  const found = new Set();

  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1];
      const pkg  = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];

      // Check for unsupported packages first (more specific error)
      for (const [name, reason] of UNSUPPORTED_PACKAGES) {
        if (pkg === name || pkg.startsWith(name + '/')) {
          throw new Error(
            `Unsupported import: '${pkg}'\n\n` +
            `  ${reason}\n\n` +
            `  See docs/UNSUPPORTED.md for the full list of unsupported features.`
          );
        }
      }

      // Node.js built-in check
      if (NODE_BUILTINS.has(pkg)) {
        throw new Error(
          `Unsupported import: '${pkg}' is a Node.js built-in module.\n\n` +
          `  Built-in Node.js modules (fs, path, crypto, etc.) cannot run inside\n` +
          `  a browser or WebView2 context. If you need filesystem access,\n` +
          `  use the Neutralino.filesystem API instead:\n` +
          `    https://neutralino.js.org/docs/api/filesystem\n\n` +
          `  See docs/UNSUPPORTED.md for the full list of unsupported features.`
        );
      }

      found.add(pkg);
    }
  }

  // Remove React/react-dom — provided by our entry wrapper, not npm-installed separately
  ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'].forEach(p => found.delete(p));

  return [...found];
}

// ── React import stripping ─────────────────────────────────────────────────────

/**
 * Strips all React and react-dom import statements from artifact source code.
 * These are re-provided by our esbuild entry wrapper, so leaving them in
 * causes "Identifier already declared" crashes.
 *
 * Handles every import form Claude produces:
 *   import React from 'react'
 *   import React, { useState } from 'react'
 *   import React, { useState, useEffect, ... } from 'react'
 *   import { useState } from 'react'
 *   import * as React from 'react'
 *   import ReactDOM from 'react-dom'
 *   import { createRoot } from 'react-dom/client'
 *   import * as ReactDOM from 'react-dom/client'
 *
 * @param {string} code
 * @returns {string}
 */
export function stripReactImports(code) {
  return code
    .replace(/^import\s+React\s*,\s*\{[^}]*\}\s*from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s+React\s+from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s*\*\s*as\s*\w+\s*from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s+\w+\s+from\s*['"]react-dom[^'"]*['"];?\s*/gm, '')
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"]react-dom[^'"]*['"];?\s*/gm, '')
    .replace(/^import\s*\*\s*as\s*\w+\s*from\s*['"]react-dom[^'"]*['"];?\s*/gm, '');
}

/**
 * Normalises the root component export so esbuild can reference it by name.
 *
 * Transforms:
 *   export default function MyApp() { ... }  →  function MyApp() { ... }
 *   export default class MyApp { ... }       →  class MyApp { ... }
 *   export default SomeExpression            →  const __DefaultExport = SomeExpression
 *
 * @param {string} code - Already stripped of React imports
 * @returns {{ code: string, rootComponent: string }}
 */
export function normaliseDefaultExport(code) {
  let rootComponent = '__DefaultExport';

  const fnMatch  = code.match(/^export\s+default\s+function\s+(\w+)/m);
  const clsMatch = code.match(/^export\s+default\s+class\s+(\w+)/m);

  if (fnMatch) {
    rootComponent = fnMatch[1];
    code = code.replace(/^export\s+default\s+function\s+(\w+)/m, 'function $1');
  } else if (clsMatch) {
    rootComponent = clsMatch[1];
    code = code.replace(/^export\s+default\s+class\s+(\w+)/m, 'class $1');
  } else {
    code = code.replace(/^export\s+default\s+/m, 'const __DefaultExport = ');
  }

  return { code, rootComponent };
}
