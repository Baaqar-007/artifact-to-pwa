/**
 * Artifact bundler — v3.0.0
 *
 * CHANGES FROM v2.2.0:
 *   - Detection logic imported from src/detect.js (hardening item #8)
 *   - React pinned to 18.3.1 in ephemeral install instead of "latest"
 *     (hardening item #3)
 *   - npm cache directory is now keyed by a SHA-256 hash of the full
 *     dependency set, so different artifacts with different deps get isolated
 *     caches and stale installs never bleed through (hardening item #7)
 *   - Unsupported imports (Node builtins, Express, etc.) now surface a
 *     human-readable error from detect.js before esbuild even runs
 */

import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname }             from 'path';
import { homedir }  from 'os';
import { execSync }         from 'child_process';
import { createHash }       from 'crypto';
import * as esbuild         from 'esbuild';
import {
  detectArtifactType,
  extractBareImports,
  stripReactImports,
  normaliseDefaultExport,
} from './detect.js';

// ── Pinned versions ───────────────────────────────────────────────────────────
// Update these when upgrading React. Run the compat test suite after any bump.
const PINNED_REACT_VERSION     = '18.3.1';
const PINNED_REACT_DOM_VERSION = '18.3.1';

// ── Neutralino client bridge injection ───────────────────────────────────────
// Injected as the first script in <head> so Neutralino.init() runs before
// any app code. Guarded by typeof check so the same HTML works if opened
// in a regular browser (e.g. during local development with npx serve).

export const NEUTRALINO_INJECT = [
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

/**
 * Returns a deterministic 12-char hex key for a set of package specs.
 * Ensures that { react, recharts } and { react, lodash } get separate
 * cache directories and never interfere with each other.
 *
 * @param {string[]} packages - sorted array of "name@version" specifiers
 * @returns {string} 12-char hex string
 */
function depSetHash(packages) {
  return createHash('sha256')
    .update([...packages].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Installs packages into a hash-keyed cache directory.
 * Uses --prefer-offline so npm reuses its global download cache when possible.
 *
 * Pinned versions ensure reproducible installs across time.
 */
async function installDeps(bareImports, spinner) {
  // Always include pinned React — it's the entry wrapper's dependency
  const depMap = {
    'react':     PINNED_REACT_VERSION,
    'react-dom': PINNED_REACT_DOM_VERSION,
  };

  // Third-party deps: install at "latest" but within the npm lock.
  // TODO: allow per-package version overrides via a config file.
  for (const pkg of bareImports) {
    depMap[pkg] = 'latest';
  }

  const hashKey  = depSetHash(Object.entries(depMap).map(([k, v]) => `${k}@${v}`));
  const cacheDir = join(homedir(), '.artifact-to-pwa', 'npm-deps', hashKey);
  const nmPath   = join(cacheDir, 'node_modules');

  // Re-use existing install if the hash matches (deps haven't changed)
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

/**
 * Bundles an artifact source file into a self-contained HTML string.
 *
 * @param {string} filePath   - Absolute path to source file
 * @param {{ appName: string, themeColor: string }} opts
 * @param {object} spinner    - ora spinner instance
 * @returns {Promise<string>} Complete HTML document
 */
export async function bundleFile(filePath, { appName, themeColor }, spinner) {
  const code = readFileSync(filePath, 'utf8');
  if (!code.trim()) throw new Error(`File is empty: ${filePath}`);

  const type = detectArtifactType(code);
  spinner.text = `Detected: ${type}`;

  // ── Full HTML — pass through with Neutralino bridge injected ───────────────
  if (type === 'full-html') {
    return injectNeutralinoScript(code);
  }

  // ── HTML fragment — wrap in shell document ─────────────────────────────────
  if (type === 'html-fragment') {
    return injectNeutralinoScript(
      `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
      `  <meta charset="UTF-8">\n` +
      `  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
      `  <title>${appName}</title>\n` +
      `</head>\n<body>\n${code}\n</body>\n</html>`
    );
  }

  // ── React / JSX — detect imports, strip React, esbuild bundle ─────────────

  // extractBareImports throws with a human-readable error for unsupported
  // imports (Node builtins, Express, Electron, etc.) before esbuild runs.
  const bareImports = extractBareImports(code);

  const nmPath = await installDeps(bareImports, spinner);

  // Strip React imports and normalise the default export
  const stripped = stripReactImports(code).trim();
  const { code: processed, rootComponent } = normaliseDefaultExport(stripped);

  // Write a temporary esbuild entry that provides React and mounts the component
  const artifactDir = dirname(filePath);   // same folder as the artifact
  const entryPath   = join(artifactDir, `.atp-entry-${Date.now()}.jsx`);  writeFileSync(
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
        '.css': 'text',         // CSS modules become strings
        '.svg': 'dataurl',
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.gif': 'dataurl',
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
    // Re-throw with cleaner message — raw esbuild errors can be verbose
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
