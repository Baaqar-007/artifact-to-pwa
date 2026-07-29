/**
 * Build orchestrator — ties all stages together.
 *
 * Pipeline:
 *   1. Resolve source  (file read or URL fetch)
 *   2. Bundle          (esbuild or pass-through)
 *   3. Shell           (download / use cached Electron)
 *   4. Inject          (copy shell, write app, rename exe)
 *   5. Done
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve }       from 'path';
import { bundleFile, LS_SHIM } from './bundle.js';
import { ensureShell }   from './shell.js';
import { injectPayload } from './inject.js';
import { fetchURL }      from './fetch.js';

const isURL = s => /^https?:\/\//i.test(String(s).trim());

const slugify = s =>
  String(s).toLowerCase()
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'my-app';

function nameFromSource(source) {
  if (isURL(source)) {
    try {
      const host = new URL(source).hostname.replace(/^www\./, '');
      const part = host.split('.')[0];
      return part.charAt(0).toUpperCase() + part.slice(1) + ' App';
    } catch { return 'My App'; }
  }
  const base = source.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || 'My App';
}

export async function build(source, options, chalk) {
  console.log('\n' + chalk.bold.cyan('  artifact-to-pwa') + chalk.gray(' v2  ') + chalk.white('→  Windows native\n'));

  const appName    = ((options.name || nameFromSource(source)) + '').trim() || 'My App';
  const slug       = slugify(appName);
  const themeColor = /^#[0-9a-f]{3,6}$/i.test(options.color || '') ? options.color : '#6366f1';
  const outDir     = resolve(options.out || `./${slug}-windows`);
  const iconPath   = options.icon ? resolve(options.icon) : null;

  console.log(chalk.gray('  App     ') + chalk.white(appName));
  console.log(chalk.gray('  Output  ') + chalk.white(outDir));
  console.log(chalk.gray('  Source  ') + chalk.white(source));
  if (iconPath) console.log(chalk.gray('  Icon    ') + chalk.white(iconPath));
  console.log();

  if (iconPath && !existsSync(iconPath)) {
    console.error(chalk.red(`  ✗ Icon not found: ${iconPath}\n`)); process.exit(1);
  }

  let html;

  if (isURL(source)) {
    process.stdout.write(chalk.gray('  ↳ Fetching...'));
    try {
      html = await fetchURL(source);
      console.log(' ' + chalk.green('done') + chalk.gray(` (${(html.length / 1024).toFixed(1)} kB)`));
    } catch (err) {
      console.log(' ' + chalk.red('failed\n'));
      console.error(chalk.red('  ✗ ') + err.message + '\n'); process.exit(1);
    }
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/(<head[^>]*>)/i, `$1\n  ${LS_SHIM}`);
    }
  } else {
    const abs = resolve(source);
    if (!existsSync(abs))         { console.error(chalk.red(`  ✗ File not found: ${source}\n`));  process.exit(1); }
    if (statSync(abs).size === 0) { console.error(chalk.red(`  ✗ File is empty: ${source}\n`));    process.exit(1); }
    try   { html = await bundleFile(abs, { appName, themeColor }, chalk); }
    catch (err) { console.error(chalk.red(`\n  ✗ Bundle failed: ${err.message}\n`)); process.exit(1); }
  }

  if (!html?.trim()) {
    console.error(chalk.red('  ✗ Build produced empty HTML.\n')); process.exit(1);
  }

  let shellDir;
  try   { shellDir = await ensureShell(chalk); }
  catch (err) { console.error(chalk.red(`\n  ✗ Shell error: ${err.message}\n`)); process.exit(1); }

  console.log();
  try   { await injectPayload({ shellDir, html, appName, slug, outDir, iconPath, chalk }); }
  catch (err) { console.error(chalk.red(`\n  ✗ Inject failed: ${err.message}\n`)); process.exit(1); }

  const dirName = outDir.split(/[/\\]/).pop();
  console.log(
    '\n' + chalk.bold.green('  ✓ Done!\n') +
    '\n' + chalk.gray('  Executable:  ') + chalk.white(`${dirName}\\${appName}.exe`) +
    '\n' + chalk.gray('  To launch:   ') + chalk.white(`double-click ${appName}.exe`) +
    '\n' + chalk.gray('  To share:    ') + chalk.white(`zip the entire ${dirName}\\ folder`) +
    '\n\n' + chalk.gray('  See README-Launch.txt inside the folder for SmartScreen instructions.\n')
  );
}
