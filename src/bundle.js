/**
 * Artifact bundler.
 *
 * Handles three source types:
 *   full-html     — passes through with localStorage shim injected
 *   html-fragment — wrapped in a shell document + shim injected
 *   react         — bundled into a self-contained JS payload via esbuild
 *                   with dependencies resolved through an ephemeral npm install
 */

import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join }          from 'path';
import { homedir, tmpdir } from 'os';
import { execSync }      from 'child_process';
import * as esbuild      from 'esbuild';

export const LS_SHIM = `<script>
/* artifact-to-pwa: Electron localStorage bridge */
(function () {
  var mem = window.__initialStorage || {};
  var api;
  function getAPI() { if (api === undefined) api = window.__electronAPI || null; return api; }
  var shim = {
    getItem:    function (k)    { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem:    function (k, v) { var s = String(v); mem[k] = s; var a = getAPI(); if (a) a.storageSet(k, s); },
    removeItem: function (k)    { delete mem[k]; var a = getAPI(); if (a) a.storageRemove(k); },
    clear:      function ()     { Object.keys(mem).forEach(function(k){ delete mem[k]; }); var a = getAPI(); if (a) a.storageClear(); },
    key:        function (n)    { var keys = Object.keys(mem); return n < keys.length ? keys[n] : null; },
    get length() { return Object.keys(mem).length; }
  };
  try { Object.defineProperty(window, 'localStorage', { value: shim, writable: false, configurable: false }); }
  catch (e) { window.localStorage = shim; }
}());
</script>`;

function detectType(code) {
  const t = code.trim();
  if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return 'full-html';
  if ([/from\s+['"]react['"]/,/export\s+default\s+function/,/useState\s*[(<]/,/useEffect\s*\(/,/return\s*\(\s*</,/<>\s*</].some(r => r.test(t))) return 'react';
  if (/^<[a-zA-Z]/.test(t)) return 'html-fragment';
  return 'html-fragment';
}

function injectShim(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/(<head[^>]*>)/i, `$1\n  ${LS_SHIM}`);
  return `<head>\n  ${LS_SHIM}\n</head>\n` + html;
}

function extractBareImports(code) {
  const found = new Set();
  const pats = [/from\s+['"]([^.'"\/][^'"]*)['"]/g, /require\s*\(\s*['"]([^.'"\/][^'"]*)['"]\s*\)/g];
  for (const re of pats) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1];
      found.add(spec.startsWith('@') ? spec.split('/').slice(0,2).join('/') : spec.split('/')[0]);
    }
  }
  ['react','react-dom','react/jsx-runtime'].forEach(p => found.delete(p));
  return [...found];
}

async function installDeps(packages, chalk) {
  const cacheDir = join(homedir(), '.artifact-to-pwa', 'npm-cache');
  mkdirSync(cacheDir, { recursive: true });
  const allPkgs  = [...new Set(['react', 'react-dom', ...packages])];
  writeFileSync(join(cacheDir, 'package.json'), JSON.stringify({
    name: 'atp-deps', version: '1.0.0',
    dependencies: Object.fromEntries(allPkgs.map(p => [p, 'latest'])),
  }, null, 2));
  process.stdout.write(chalk.gray('  \u21b3 Installing ') + chalk.white(allPkgs.join(', ')) + chalk.gray('...'));
  try {
    execSync('npm install --prefer-offline --no-audit --no-fund --loglevel=error', { cwd: cacheDir, stdio: 'pipe' });
    console.log(' ' + chalk.green('done'));
  } catch (err) {
    console.log(' ' + chalk.red('failed'));
    throw new Error(`npm install failed: ${err.stderr?.toString().slice(0,200) || err.message}`);
  }
  return join(cacheDir, 'node_modules');
}

export async function bundleFile(filePath, { appName, themeColor }, chalk) {
  const code = readFileSync(filePath, 'utf8');
  if (!code.trim()) throw new Error(`File is empty: ${filePath}`);
  const type = detectType(code);
  console.log(chalk.gray('  \u21b3 Detected  ') + chalk.yellow(type));

  if (type === 'full-html')     return injectShim(code);
  if (type === 'html-fragment') return injectShim(`<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${appName}</title>\n</head>\n<body>\n${code}\n</body>\n</html>`);

  // React
  const nmPath = await installDeps(extractBareImports(code), chalk);

  let processed = code
    .replace(/^export\s+default\s+function\s+(\w+)/m, 'function $1')
    .replace(/^export\s+default\s+class\s+(\w+)/m,    'class $1')
    .replace(/^export\s+default\s+/m,                  'const __DefaultExport = ');

  let root = '__DefaultExport';
  const fnM = code.match(/^export\s+default\s+function\s+(\w+)/m);
  const clM = code.match(/^export\s+default\s+class\s+(\w+)/m);
  if (fnM) root = fnM[1]; else if (clM) root = clM[1];

  const entryPath = join(tmpdir(), `atp-${Date.now()}.jsx`);
  writeFileSync(entryPath, `import React,{useState,useEffect,useRef,useCallback,useMemo,useReducer,useContext,createContext} from 'react';\nimport{createRoot}from 'react-dom/client';\n${processed}\ncreateRoot(document.getElementById('root')).render(React.createElement(${root}));\n`);

  process.stdout.write(chalk.gray('  \u21b3 Bundling...'));
  let bundledJS;
  try {
    const r = await esbuild.build({
      entryPoints:[entryPath], bundle:true, format:'iife', write:false, minify:true,
      jsxFactory:'React.createElement', jsxFragment:'React.Fragment',
      loader:{'.jsx':'jsx','.js':'jsx','.tsx':'tsx','.ts':'ts','.css':'text','.svg':'dataurl','.png':'dataurl'},
      nodePaths:[nmPath],
      define:{'process.env.NODE_ENV':'"production"','global':'globalThis'},
    });
    bundledJS = r.outputFiles[0].text;
    console.log(' ' + chalk.green('done') + chalk.gray(` (${(bundledJS.length/1024).toFixed(0)} kB)`));
  } catch (err) {
    console.log(' ' + chalk.red('failed'));
    throw new Error(`esbuild: ${err.message}`);
  } finally { try { unlinkSync(entryPath); } catch {} }

  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${appName}</title>\n  ${LS_SHIM}\n  <style>html,body,#root{height:100%;margin:0;padding:0;}</style>\n</head>\n<body>\n  <div id="root"></div>\n  <script>${bundledJS}</script>\n</body>\n</html>`;
}
