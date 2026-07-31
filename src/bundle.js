/**
 * Artifact bundler — v3.0.0
 * LS_SHIM removed — WebView2 persists localStorage natively.
 * NEUTRALINO_INJECT added — loads neutralino.js client bridge.
 * React import stripping retained from v2.1.0 Fix #4.
 */

import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join }            from 'path';
import { homedir, tmpdir } from 'os';
import { execSync }        from 'child_process';
import * as esbuild        from 'esbuild';

export const NEUTRALINO_INJECT = `<script src="/js/neutralino.js"></script>
<script>if (typeof Neutralino !== 'undefined') Neutralino.init();</script>`;

function detectType(code) {
  const t = code.trim();
  if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return 'full-html';
  if ([/from\s+['"]react['"]/,/export\s+default\s+function/,/export\s+default\s+class/,/useState\s*[(<]/,/useEffect\s*\(/,/return\s*\(\s*</,/<>\s*</].some(r=>r.test(t))) return 'react';
  if (/^<[a-zA-Z]/.test(t)) return 'html-fragment';
  return 'html-fragment';
}

function injectNeutralinoScript(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/(<head[^>]*>)/i, `$1\n  ${NEUTRALINO_INJECT}`);
  return `<head>\n  ${NEUTRALINO_INJECT}\n</head>\n` + html;
}

function extractBareImports(code) {
  const found = new Set();
  [/from\s+['"]([^.'"\/][^'"]*)['"]/g, /require\s*\(\s*['"]([^.'"\/][^'"]*)['"]\s*\)/g].forEach(re => {
    let m; while ((m = re.exec(code)) !== null) {
      const s = m[1]; found.add(s.startsWith('@') ? s.split('/').slice(0,2).join('/') : s.split('/')[0]);
    }
  });
  ['react','react-dom','react/jsx-runtime','react-dom/client'].forEach(p => found.delete(p));
  return [...found];
}

async function installDeps(packages, spinner) {
  const cacheDir = join(homedir(), '.artifact-to-pwa', 'npm-cache');
  mkdirSync(cacheDir, { recursive: true });
  const allPkgs = [...new Set(['react','react-dom',...packages])];
  spinner.text = `Installing ${allPkgs.join(', ')}...`;
  writeFileSync(join(cacheDir,'package.json'), JSON.stringify({name:'atp-deps',version:'1.0.0',dependencies:Object.fromEntries(allPkgs.map(p=>[p,'latest']))},null,2));
  try {
    execSync('npm install --prefer-offline --no-audit --no-fund --loglevel=error',{cwd:cacheDir,stdio:'pipe'});
  } catch(err) {
    throw new Error(`npm install failed: ${err.stderr?.toString().slice(0,300)||err.message}`);
  }
  return join(cacheDir,'node_modules');
}

function stripReactImports(code) {
  return code
    .replace(/^import\s+React\s*,\s*\{[^}]*\}\s*from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s+React\s+from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s*\*\s*as\s*\w+\s*from\s*['"]react['"];?\s*/gm, '')
    .replace(/^import\s+\w+\s+from\s*['"]react-dom[^'"]*['"];?\s*/gm, '')
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"]react-dom[^'"]*['"];?\s*/gm, '')
    .replace(/^import\s*\*\s*as\s*\w+\s*from\s*['"]react-dom[^'"]*['"];?\s*/gm, '');
}

export async function bundleFile(filePath, { appName, themeColor }, spinner) {
  const code = readFileSync(filePath,'utf8');
  if (!code.trim()) throw new Error(`File is empty: ${filePath}`);
  const type = detectType(code);
  spinner.text = `Detected: ${type}`;

  if (type === 'full-html')     return injectNeutralinoScript(code);
  if (type === 'html-fragment') return injectNeutralinoScript(
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1.0">\n  <title>${appName}</title>\n</head>\n<body>\n${code}\n</body>\n</html>`
  );

  const nmPath  = await installDeps(extractBareImports(code), spinner);
  let processed = stripReactImports(code).trim();
  let rootComp  = '__DefaultExport';
  const fnM = processed.match(/^export\s+default\s+function\s+(\w+)/m);
  const clM = processed.match(/^export\s+default\s+class\s+(\w+)/m);
  if      (fnM) { rootComp = fnM[1]; processed = processed.replace(/^export\s+default\s+function\s+(\w+)/m,'function $1'); }
  else if (clM) { rootComp = clM[1]; processed = processed.replace(/^export\s+default\s+class\s+(\w+)/m,'class $1'); }
  else          { processed = processed.replace(/^export\s+default\s+/m,'const __DefaultExport = '); }

  const entry = join(tmpdir(),`atp-${Date.now()}.jsx`);
  writeFileSync(entry,
    `import React,{useState,useEffect,useRef,useCallback,useMemo,useReducer,useContext,createContext} from 'react';\n` +
    `import{createRoot}from 'react-dom/client';\n${processed}\n` +
    `createRoot(document.getElementById('root')).render(React.createElement(${rootComp}));\n`
  );

  spinner.text = 'Bundling...';
  let js;
  try {
    const r = await esbuild.build({
      entryPoints:[entry],bundle:true,format:'iife',write:false,minify:true,
      jsxFactory:'React.createElement',jsxFragment:'React.Fragment',
      loader:{'.jsx':'jsx','.js':'jsx','.tsx':'tsx','.ts':'ts','.css':'text','.svg':'dataurl','.png':'dataurl'},
      nodePaths:[nmPath],define:{'process.env.NODE_ENV':'"production"','global':'globalThis'},
    });
    js = r.outputFiles[0].text;
  } finally { try{unlinkSync(entry);}catch{} }

  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1.0">\n  <meta name="theme-color" content="${themeColor}">\n  <title>${appName}</title>\n  ${NEUTRALINO_INJECT}\n  <style>html,body,#root{height:100%;margin:0;padding:0;}</style>\n</head>\n<body>\n  <div id="root"></div>\n  <script>${js}</script>\n</body>\n</html>`;
}
