/**
 * Electron shell downloader and cache manager.
 *
 * Downloads a prebuilt Electron binary for Windows (win32-x64) from the
 * official GitHub Releases, caches it in ~/.artifact-to-pwa/shells/, and
 * returns the path to the extracted directory.
 *
 * Subsequent builds are instant — the ~85 MB download only happens once.
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join }       from 'path';
import { homedir }    from 'os';
import extractZip     from 'extract-zip';
import { tmpdir }     from 'os';

const CACHE_ROOT = join(homedir(), '.artifact-to-pwa', 'shells');

async function resolveLatestVersion() {
  const res = await fetch(
    'https://api.github.com/repos/electron/electron/releases/latest',
    { headers: { 'User-Agent': 'artifact-to-pwa' } }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status} resolving Electron version`);
  const data = await res.json();
  return data.tag_name.replace(/^v/, '');
}

function buildDownloadURL(version) {
  return `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`;
}

async function downloadWithProgress(url, destPath, chalk) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'artifact-to-pwa' },
    redirect: 'follow',
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading Electron shell`);

  const total   = parseInt(res.headers.get('content-length') || '0', 10);
  const totalMB = (total / 1024 / 1024).toFixed(0);
  let   downloaded = 0;
  const BAR = 24;

  const dest   = createWriteStream(destPath);
  const reader = res.body.getReader();
  const write  = chunk => new Promise((res, rej) => dest.write(chunk, e => e ? rej(e) : res()));

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await write(value);
    downloaded += value.length;
    const pct    = total ? downloaded / total : 0;
    const filled = Math.round(pct * BAR);
    const bar    = '\u2588'.repeat(filled) + '\u2591'.repeat(BAR - filled);
    const mb     = (downloaded / 1024 / 1024).toFixed(1);
    process.stdout.write(`\r  ${chalk.gray('[')}${chalk.cyan(bar)}${chalk.gray(']')} ${chalk.white(mb)} / ${totalMB} MB`);
  }
  process.stdout.write('\n');
  await new Promise((res, rej) => dest.end(e => e ? rej(e) : res()));
}

export async function ensureShell(chalk) {
  let version;
  try {
    version = await resolveLatestVersion();
  } catch (err) {
    throw new Error(`Could not resolve Electron version: ${err.message}`);
  }

  const shellDir = join(CACHE_ROOT, `electron-${version}-win32-x64`);

  if (existsSync(join(shellDir, 'electron.exe'))) {
    console.log(chalk.gray(`  \u21b3 Shell    `) + chalk.white(`Electron ${version}`) + chalk.gray(` (cached)`));
    return shellDir;
  }

  console.log(chalk.gray(`  \u21b3 Shell    `) + chalk.white(`Electron ${version}`) + chalk.gray(` \u2014 downloading...`));
  mkdirSync(CACHE_ROOT, { recursive: true });

  const zipPath = join(tmpdir(), `electron-${version}-win32-x64.zip`);

  try {
    await downloadWithProgress(buildDownloadURL(version), zipPath, chalk);
  } catch (err) {
    throw new Error(`Download failed: ${err.message}`);
  }

  process.stdout.write(chalk.gray('  \u21b3 Extracting...'));
  try {
    mkdirSync(shellDir, { recursive: true });
    await extractZip(zipPath, { dir: shellDir });
    console.log(' ' + chalk.green('done'));
  } catch (err) {
    throw new Error(`Extraction failed: ${err.message}`);
  } finally {
    try { (await import('fs')).unlinkSync(zipPath); } catch {}
  }

  if (!existsSync(join(shellDir, 'electron.exe'))) {
    throw new Error(`electron.exe not found after extraction in ${shellDir}`);
  }

  return shellDir;
}
