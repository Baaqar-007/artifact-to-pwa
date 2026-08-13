/**
 * Build orchestrator — v3.0.0
 *
 * CHANGES FROM v2.2.0:
 *   - ensureShell() now returns { binPath, dllPath, clientLibPath, version }.
 *     dllPath is passed through to injectPayload() so WebView2Loader.dll
 *     is copied alongside the exe when present.
 *   - Output message updated to note the WebView2 requirement clearly.
 */

import { existsSync, statSync } from 'fs';
import { resolve }              from 'path';
import ora                      from 'ora';
import { bundleFile, NEUTRALINO_INJECT } from './bundle.js';
import { ensureShell }          from './shell.js';
import { injectPayload, portFromSlug } from './inject.js';
import { fetchURL }             from './fetch.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const isURL   = s => /^https?:\/\//i.test(String(s).trim());
const slugify = s =>
  String(s).toLowerCase()
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'my-app';

function nameFromSource(source) {
  if (isURL(source)) return 'My App';
  const base = source.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || 'My App';
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function build(source, options, chalk) {
  try {
    await runBuild(source, options, chalk);
  } catch (err) {
    console.error('\n' + chalk.red('  ✗ ') + err.message);
    if (process.env.DEBUG) console.error('\n' + chalk.gray(err.stack));
    else console.error(chalk.gray('\n  Run with DEBUG=1 for full stack trace.\n'));
    process.exit(1);
  }
}

async function runBuild(source, options, chalk) {
  console.log(
    '\n' +
    chalk.bold.cyan('  artifact-to-pwa') +
    chalk.gray(' v3  ') +
    chalk.white('→  Windows native  ') +
    chalk.gray('(~5 MB via Neutralino + WebView2)\n')
  );

  const appName    = ((options.name || nameFromSource(source)) + '').trim() || 'My App';
  const slug       = slugify(appName);
  const themeColor = /^#[0-9a-f]{3,6}$/i.test(options.color || '') ? options.color : '#6366f1';
  const outDir     = resolve(options.out || `./${slug}-windows`);
  const iconPath   = options.icon ? resolve(options.icon) : null;
  const port       = portFromSlug(slug);

  console.log(chalk.gray('  App     ') + chalk.white(appName));
  console.log(chalk.gray('  Output  ') + chalk.white(outDir));
  console.log(chalk.gray('  Source  ') + chalk.white(source));
  console.log(chalk.gray('  Port    ') + chalk.gray(`localhost:${port}  (localStorage origin)`));
  if (iconPath) console.log(chalk.gray('  Icon    ') + chalk.white(iconPath));
  console.log();

  if (iconPath && !existsSync(iconPath)) {
    console.error(chalk.red(`  ✗ Icon file not found: ${iconPath}\n`));
    process.exit(1);
  }

  // ── Stage 1: Bundle ─────────────────────────────────────────────────────────
  let html;

  if (isURL(source)) {
    try { await fetchURL(source); } catch (err) {
      console.error(chalk.red('  ✗ ') + err.message + '\n');
      process.exit(1);
    }
  } else {
    const abs = resolve(source);
    if (!existsSync(abs)) {
      console.error(chalk.red(`  ✗ File not found: ${source}\n`) + chalk.gray('  Check the path and try again.\n'));
      process.exit(1);
    }
    if (statSync(abs).size === 0) {
      console.error(chalk.red(`  ✗ File is empty: ${source}\n`));
      process.exit(1);
    }

    const spinner = ora({ text: 'Bundling artifact...', color: 'cyan' }).start();
    try {
      html = await bundleFile(abs, { appName, themeColor }, spinner);
      spinner.succeed(
        chalk.white('Bundled') +
        chalk.gray(` (${(html.length / 1024).toFixed(0)} kB)`)
      );
    } catch (err) {
      spinner.fail(chalk.red('Bundle failed'));
      // detect.js raises specific errors for unsupported imports —
      // those messages are already human-readable, just print them.
      if (err.message.includes('esbuild:')) {
        console.error(
          chalk.red('\n  ✗ esbuild error\n') +
          chalk.gray('  The artifact may have a syntax error or unsupported import.\n') +
          chalk.gray('  Details:\n\n') +
          chalk.gray(err.message.split('\n').map(l => '    ' + l).join('\n')) + '\n'
        );
      } else {
        // Unsupported import / Node built-in / actionable error from detect.js
        console.error('\n' + chalk.red('  ✗ ') + err.message + '\n');
      }
      process.exit(1);
    }
  }

  if (!html?.trim()) {
    console.error(chalk.red('  ✗ Build produced empty HTML. Please file a bug.\n'));
    process.exit(1);
  }

  // ── Stage 2: Neutralino shell ───────────────────────────────────────────────
  let shellAssets;
  const shellSpinner = ora({ text: 'Checking Neutralino runtime...', color: 'cyan' }).start();
  try {
    shellSpinner.stop();
    shellAssets = await ensureShell(chalk);
  } catch (err) {
    shellSpinner.fail(chalk.red('Runtime error'));
    console.error('\n' + chalk.red('  ✗ ') + err.message + '\n');
    process.exit(1);
  }

  // ── Stage 3: Inject ─────────────────────────────────────────────────────────
  console.log();
  try {
    await injectPayload({
      binPath:           shellAssets.binPath,
      dllPath:           shellAssets.dllPath,   
      clientLibPath:     shellAssets.clientLibPath,
      neutralinoVersion: shellAssets.version,
      html, appName, slug, port, outDir, iconPath, chalk,
    });
  } catch (err) {
    console.error(chalk.red(`\n  ✗ Inject failed: ${err.message}\n`));
    process.exit(1);
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  const dirName = outDir.split(/[/\\]/).pop();
const launcher = process.platform === 'win32' ? `${appName}.exe` : 'start.sh';
const requires = process.platform === 'win32'
  ? 'WebView2 (pre-installed on Win11 + updated Win10)'
  : 'WebKitGTK (sudo apt install libwebkit2gtk-4.0-dev)';

console.log(
  '\n' + chalk.bold.green('  ✓ Done!\n') +
  '\n' + chalk.gray('  Launch:    ') + chalk.white(`double-click ${dirName}/${launcher}`) +
  '\n' + chalk.gray('  To share:  ') + chalk.white(`zip the entire ${dirName}/ folder`) +
  '\n' + chalk.gray('  Requires:  ') + chalk.gray(requires) +
  '\n\n' + chalk.gray('  See README-Launch.txt for details.\n')
);
}
