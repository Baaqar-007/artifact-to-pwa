/**
 * Artifact bundler — v3.0.0
 *
 * Changes in this version:
 *   - CLAUDE_RUNTIME_SHIM imported from runtime.js and prepended to every
 *     generated page before the Neutralino bridge. This injects window.storage
 *     and any future Claude runtime shims automatically.
 *   - Temporary esbuild entry file is now written alongside the artifact
 *     (same directory) instead of os.tmpdir(). This fixes relative import
 *     resolution for CSS, images, and any other files the artifact imports
 *     with paths like "./styles.css" or "./icon.png".
 *   - React pinned to 18.3.1 in ephemeral install.
 *   - npm cache directory keyed by SHA-256 of the dependency set.
 *   - Detection, import extraction, and stripping imported from detect.js.
 */

import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname }    from 'path';
import { homedir }          from 'os';
import { execSync }         from 'child_process';
import { createHash }       from 'crypto';
import * as esbuild         from 'esbuild';
import { CLAUDE_RUNTIME_SHIM } from './runtime.js';
import {
  detectArtifactType,
  extractBareImports,
  stripReactImports,
  normaliseDefaultExport,
} from './detect.js';

// ── Pinned versions ───────────────────────────────────────────────────────────
const PINNED_REACT_VERSION     = '18.3.1';
const PINNED_REACT_DOM_VERSION = '18.3.1';

// ── Injection block ───────────────────────────────────────────────────────────
// Injection order (executed top-to-bottom in the browser):
//   1. CLAUDE_RUNTIME_SHIM  — window.storage and future Claude API shims
//   2. neutralino.js        — Neutralino client bridge
//   3. Neutralino.init()    — starts the IPC handshake with the binary
//
// The runtime shim MUST come first so it is available before app code.
// The typeof guard on Neutralino.init() makes the HTML safe to open in a
// regular browser during development (e.g. npx serve).

export const NEUTRALINO_INJECT = [
  CLAUDE_RUNTIME_SHIM,
  `<script src="/js/neutralino.js"></script>`,
  `<script>if (typeof Neutralino !== 'undefined') Neutralino.init();</script>`,
].join('\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

function injectNeutralinoScript(html) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${NEUTRALINO_INJECT}`);
  }
  return `<head>\n  ${NEUTRALINO_INJECT}\n</head>\n` + html;
}

// ── Dependency cache keyed by dep-set hash ────────────────────────────────────

function depSetHash(packages) {
  return createHash('sha256')
    .update([...packages].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

async function installDeps(bareImports, spinner) {
  const depMap = {
    'react':     PINNED_REACT_VERSION,
    'react-dom': PINNED_REACT_DOM_VERSION,
  };
  for (const pkg of bareImports) {
    depMap[pkg] = 'latest';
  }

  const hashKey  = depSetHash(Object.entries(depMap).map(([k, v]) => `${k}@${v}`));
  const cacheDir = join(homedir(), '.artifact-to-pwa', 'npm-deps', hashKey);
  const nmPath   = join(cacheDir, 'node_modules');

  if (existsSync(nmPath)) {
    spinner.text = `Dependencies cached (${Object.keys(depMap).join(', ')})`;
    return nmPath;
  }

  spinner.text = `Installing ${Object.keys(depMap).join(', ')}...`;
  mkdirSync(cacheDir, { recursive: true });

  writeFileSync(
    join(cacheDir, 'package.json'),
    JSON.stringify({ name: 'atp-deps', version: '1.0.0', dependencies: depMap }, null, 2)
  );

  try {
    execSync(
      'npm install --prefer-offline --no-audit --no-fund --loglevel=error',
      { cwd: cacheDir, stdio: 'pipe' }
    );
  } catch (err) {
    throw new Error(
      `npm install failed for: ${Object.keys(depMap).join(', ')}\n` +
      `  Ensure npm is installed and you have internet access.\n` +
      `  Cache directory: ${cacheDir}\n` +
      `  Details: ${err.stderr?.toString().slice(0, 300) || err.message}`
    );
  }

  return nmPath;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function bundleFile(filePath, { appName, themeColor }, spinner) {
  const code = readFileSync(filePath, 'utf8');
  if (!code.trim()) throw new Error(`File is empty: ${filePath}`);

  const type = detectArtifactType(code);
  spinner.text = `Detected: ${type}`;

  // ── Full HTML ──────────────────────────────────────────────────────────────
  if (type === 'full-html') {
    return injectNeutralinoScript(code);
  }

  // ── HTML fragment ──────────────────────────────────────────────────────────
  if (type === 'html-fragment') {
    return injectNeutralinoScript(
      `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
      `  <meta charset="UTF-8">\n` +
      `  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
      `  <title>${appName}</title>\n` +
      `</head>\n<body>\n${code}\n</body>\n</html>`
    );
  }

  // ── React / JSX ────────────────────────────────────────────────────────────

  // extractBareImports throws with a human-readable error for Node built-ins
  // and known unsupported packages (express, electron, next, etc.)
  const bareImports = extractBareImports(code);
  const nmPath      = await installDeps(bareImports, spinner);

  const stripped = stripReactImports(code).trim();
  const { code: processed, rootComponent } = normaliseDefaultExport(stripped);

  // Write the temporary esbuild entry BESIDE the artifact (not in os.tmpdir).
  // This is critical: esbuild resolves relative imports like "./styles.css" and
  // "./icon.png" relative to the entry file's directory. If the entry lives in
  // tmpdir, those paths point nowhere and the build fails. Placing the entry in
  // the same directory as the artifact preserves all relative import resolution.
  const artifactDir = dirname(filePath);
  const entryPath   = join(artifactDir, `.atp-entry-${Date.now()}.jsx`);

  writeFileSync(
    entryPath,
    `import React, {\n` +
    `  useState, useEffect, useRef, useCallback,\n` +
    `  useMemo, useReducer, useContext, createContext,\n` +
    `} from 'react';\n` +
    `import { createRoot } from 'react-dom/client';\n\n` +
    `${processed}\n\n` +
    `createRoot(document.getElementById('root')).render(\n` +
    `  React.createElement(${rootComponent})\n` +
    `);\n`
  );

  spinner.text = 'Bundling...';
  let bundledJS;
  try {
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle:      true,
      format:      'iife',
      write:       false,
      minify:      true,
      sourcemap:   false,
      jsxFactory:  'React.createElement',
      jsxFragment: 'React.Fragment',
      loader: {
        '.jsx': 'jsx', '.js': 'jsx',
        '.tsx': 'tsx', '.ts': 'ts',
        '.css':   'text',
        '.svg':   'dataurl',
        '.png':   'dataurl',
        '.jpg':   'dataurl',
        '.jpeg':  'dataurl',
        '.gif':   'dataurl',
        '.webp':  'dataurl',
        '.woff':  'dataurl',
        '.woff2': 'dataurl',
      },
      nodePaths: [nmPath],
      define: {
        'process.env.NODE_ENV': '"production"',
        'global': 'globalThis',
      },
    });
    bundledJS = result.outputFiles[0].text;
  } catch (err) {
    const lines = err.message.split('\n').slice(0, 10).join('\n');
    throw new Error(`esbuild:\n${lines}`);
  } finally {
    try { unlinkSync(entryPath); } catch {}
  }

  return (
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
    `  <meta charset="UTF-8">\n` +
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
    `  <meta name="theme-color" content="${themeColor}">\n` +
    `  <title>${appName}</title>\n` +
    `  ${NEUTRALINO_INJECT}\n` +
    `  <style>html,body,#root{height:100%;margin:0;padding:0;}</style>\n` +
    `</head>\n<body>\n` +
    `  <div id="root"></div>\n` +
    `  <script>${bundledJS}</script>\n` +
    `</body>\n</html>`
  );
}
