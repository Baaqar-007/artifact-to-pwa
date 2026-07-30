/**
 * Build orchestrator — v2.1.0
 * Fix #5: ora spinners, global try/catch, proper exit codes
 */

import { existsSync, statSync } from 'fs';
import { resolve }              from 'path';
import ora                      from 'ora';
import { bundleFile, LS_SHIM }  from './bundle.js';
import { ensureShell }          from './shell.js';
import { injectPayload }        from './inject.js';
import { fetchURL }             from './fetch.js';

const isURL    = s => /^https?:\/\//i.test(String(s).trim());
const slugify  = s => String(s).toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'') || 'my-app';

function nameFromSource(source) {
  if (isURL(source)) return 'My App';
  const base = source.replace(/\\/g,'/').split('/').pop().replace(/\.[^.]+$/,'');
  return base.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim() || 'My App';
}

export async function build(source, options, chalk) {
  try {
    await runBuild(source, options, chalk);
  } catch (err) {
    console.error('\n' + chalk.red('  ✗ Unexpected error: ') + err.message);
    if (process.env.DEBUG) console.error('\n' + chalk.gray(err.stack));
    else console.error(chalk.gray('  Run with DEBUG=1 for full stack trace.\n'));
    process.exit(1);
  }
}

async function runBuild(source, options, chalk) {
  console.log('\n' + chalk.bold.cyan('  artifact-to-pwa') + chalk.gray(' v2  ') + chalk.white('→  Windows native\n'));

  const appName    = ((options.name || nameFromSource(source)) + '').trim() || 'My App';
  const slug       = slugify(appName);
  const themeColor = /^#[0-9a-f]{3,6}$/i.test(options.color||'') ? options.color : '#6366f1';
  const outDir     = resolve(options.out || `./${slug}-windows`);
  const iconPath   = options.icon ? resolve(options.icon) : null;

  console.log(chalk.gray('  App     ') + chalk.white(appName));
  console.log(chalk.gray('  Output  ') + chalk.white(outDir));
  console.log(chalk.gray('  Source  ') + chalk.white(source));
  if (iconPath) console.log(chalk.gray('  Icon    ') + chalk.white(iconPath));
  console.log();

  if (iconPath && !existsSync(iconPath)) {
    console.error(chalk.red(`  ✗ Icon file not found: ${iconPath}\n`)); process.exit(1);
  }

  let html;

  if (isURL(source)) {
    try { await fetchURL(source); } catch (err) {
      console.error(chalk.red('  ✗ ') + err.message + '\n'); process.exit(1);
    }
  } else {
    const abs = resolve(source);
    if (!existsSync(abs))            { console.error(chalk.red(`  ✗ File not found: ${source}\n`) + chalk.gray('  Check the path and try again.\n')); process.exit(1); }
    if (statSync(abs).size === 0)    { console.error(chalk.red(`  ✗ File is empty: ${source}\n`)); process.exit(1); }

    const spinner = ora({ text: 'Bundling artifact...', color: 'cyan' }).start();
    try {
      html = await bundleFile(abs, { appName, themeColor }, spinner);
      spinner.succeed(chalk.white('Bundled') + chalk.gray(` (${(html.length/1024).toFixed(0)} kB)`));
    } catch (err) {
      spinner.fail(chalk.red('Bundle failed'));
      if (err.message.includes('esbuild'))       console.error(chalk.red('\n  ✗ esbuild error\n') + chalk.gray('  The artifact may have a syntax error or unsupported import.\n  Details: ' + err.message) + '\n');
      else if (err.message.includes('npm'))      console.error(chalk.red('\n  ✗ Dependency install failed\n') + chalk.gray('  Ensure npm is installed and you have an internet connection.\n  Details: ' + err.message) + '\n');
      else                                       console.error(chalk.red(`\n  ✗ ${err.message}\n`));
      process.exit(1);
    }
  }

  if (!html?.trim()) { console.error(chalk.red('  ✗ Build produced empty HTML.\n')); process.exit(1); }

  const shellSpinner = ora({ text: 'Checking Electron shell...', color: 'cyan' }).start();
  let shellDir;
  try {
    shellSpinner.stop();
    shellDir = await ensureShell(chalk);
  } catch (err) {
    shellSpinner.fail(chalk.red('Shell error'));
    console.error(chalk.red(`\n  ✗ ${err.message}\n`)); process.exit(1);
  }

  console.log();
  const injectSpinner = ora({ text: 'Injecting payload...', color: 'cyan' }).start();
  try {
    injectSpinner.stop();
    await injectPayload({ shellDir, html, appName, slug, outDir, iconPath, chalk });
  } catch (err) {
    injectSpinner.fail(chalk.red('Injection failed'));
    console.error(chalk.red(`\n  ✗ ${err.message}\n`)); process.exit(1);
  }

  const dirName = outDir.split(/[/\\]/).pop();
  console.log(
    '\n' + chalk.bold.green('  ✓ Done!\n') +
    '\n' + chalk.gray('  Launcher:    ') + chalk.white(`${dirName}\\Start ${appName}.bat`) +
    '\n' + chalk.gray('  Executable:  ') + chalk.white(`${dirName}\\_internal\\${appName}.exe`) +
    '\n' + chalk.gray('  To share:    ') + chalk.white(`zip the entire ${dirName}\\ folder`) +
    '\n\n' + chalk.gray('  See README-Launch.txt for SmartScreen bypass instructions.\n')
  );
}
