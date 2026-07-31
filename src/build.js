/**
 * Build orchestrator — v3.0.0
 * Updated for Neutralino: new ensureShell signature, port computation, output messages.
 */

import { existsSync, statSync } from 'fs';
import { resolve }              from 'path';
import ora                      from 'ora';
import { bundleFile, NEUTRALINO_INJECT } from './bundle.js';
import { ensureShell }          from './shell.js';
import { injectPayload, portFromSlug } from './inject.js';
import { fetchURL }             from './fetch.js';

const isURL   = s => /^https?:\/\//i.test(String(s).trim());
const slugify = s => String(s).toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'')||'my-app';

function nameFromSource(source) {
  if (isURL(source)) return 'My App';
  const base = source.replace(/\\/g,'/').split('/').pop().replace(/\.[^.]+$/,'');
  return base.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim()||'My App';
}

export async function build(source, options, chalk) {
  try { await runBuild(source, options, chalk); }
  catch(err) {
    console.error('\n'+chalk.red('  \u2717 Unexpected error: ')+err.message);
    if (process.env.DEBUG) console.error('\n'+chalk.gray(err.stack));
    else console.error(chalk.gray('  Run with DEBUG=1 for full stack trace.\n'));
    process.exit(1);
  }
}

async function runBuild(source, options, chalk) {
  console.log('\n'+chalk.bold.cyan('  artifact-to-pwa')+chalk.gray(' v2  ')+chalk.white('\u2192  Windows native  ')+chalk.gray('(~5 MB via Neutralino)\n'));

  const appName    = ((options.name||nameFromSource(source))+'').trim()||'My App';
  const slug       = slugify(appName);
  const themeColor = /^#[0-9a-f]{3,6}$/i.test(options.color||'') ? options.color : '#6366f1';
  const outDir     = resolve(options.out||`./${slug}-windows`);
  const iconPath   = options.icon ? resolve(options.icon) : null;
  const port       = portFromSlug(slug);

  console.log(chalk.gray('  App     ')+chalk.white(appName));
  console.log(chalk.gray('  Output  ')+chalk.white(outDir));
  console.log(chalk.gray('  Source  ')+chalk.white(source));
  console.log(chalk.gray('  Port    ')+chalk.gray(`localhost:${port}  (localStorage origin)`));
  if (iconPath) console.log(chalk.gray('  Icon    ')+chalk.white(iconPath));
  console.log();

  if (iconPath && !existsSync(iconPath)) { console.error(chalk.red(`  \u2717 Icon not found: ${iconPath}\n`)); process.exit(1); }

  let html;
  if (isURL(source)) {
    try { await fetchURL(source); } catch(err) { console.error(chalk.red('  \u2717 ')+err.message+'\n'); process.exit(1); }
  } else {
    const abs = resolve(source);
    if (!existsSync(abs))         { console.error(chalk.red(`  \u2717 File not found: ${source}\n`)+chalk.gray('  Check the path and try again.\n')); process.exit(1); }
    if (statSync(abs).size === 0) { console.error(chalk.red(`  \u2717 File is empty: ${source}\n`)); process.exit(1); }

    const spinner = ora({text:'Bundling artifact...',color:'cyan'}).start();
    try {
      html = await bundleFile(abs, {appName,themeColor}, spinner);
      spinner.succeed(chalk.white('Bundled')+chalk.gray(` (${(html.length/1024).toFixed(0)} kB)`));
    } catch(err) {
      spinner.fail(chalk.red('Bundle failed'));
      if (err.message.includes('esbuild'))    console.error(chalk.red('\n  \u2717 esbuild error\n')+chalk.gray('  Details: '+err.message)+'\n');
      else if (err.message.includes('npm'))   console.error(chalk.red('\n  \u2717 Dependency install failed\n')+chalk.gray('  Details: '+err.message)+'\n');
      else                                    console.error(chalk.red(`\n  \u2717 ${err.message}\n`));
      process.exit(1);
    }
  }

  if (!html?.trim()) { console.error(chalk.red('  \u2717 Build produced empty HTML.\n')); process.exit(1); }

  let shellAssets;
  const ss = ora({text:'Checking Neutralino runtime...',color:'cyan'}).start();
  try { ss.stop(); shellAssets = await ensureShell(chalk); }
  catch(err) { ss.fail(chalk.red('Runtime error')); console.error(chalk.red(`\n  \u2717 ${err.message}\n`)); process.exit(1); }

  console.log();
  try {
    await injectPayload({
      binPath: shellAssets.binPath, clientLibPath: shellAssets.clientLibPath,
      neutralinoVersion: shellAssets.version, html, appName, slug, port, outDir, iconPath, chalk,
    });
  } catch(err) { console.error(chalk.red(`\n  \u2717 Inject failed: ${err.message}\n`)); process.exit(1); }

  const dirName = outDir.split(/[/\\]/).pop();
  console.log(
    '\n'+chalk.bold.green('  \u2713 Done!\n')+
    '\n'+chalk.gray('  Launch:    ')+chalk.white(`double-click ${dirName}\\${appName}.exe`)+
    '\n'+chalk.gray('  To share:  ')+chalk.white(`zip the entire ${dirName}\\ folder`)+
    '\n'+chalk.gray('  Requires:  ')+chalk.gray('WebView2 (pre-installed on Win11 + updated Win10)')+
    '\n\n'+chalk.gray('  See README-Launch.txt for details and WebView2 download link.\n')
  );
}
