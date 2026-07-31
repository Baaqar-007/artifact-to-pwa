/**
 * Neutralino binary fetcher — v3.0.0
 * Dynamically downloads neutralino-win_x64.exe and neutralino.js
 * from GitHub Releases. Caches in ~/.artifact-to-pwa/neutralino-<version>/.
 * No binaries bundled in the npm package.
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join }    from 'path';
import { homedir } from 'os';

const CACHE_ROOT = join(homedir(), '.artifact-to-pwa', 'neutralino');
const REPO       = 'neutralinojs/neutralinojs';

async function resolveLatestVersion() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { 'User-Agent': 'artifact-to-pwa' } }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status} resolving Neutralino version`);
  return (await res.json()).tag_name.replace(/^v/, '');
}

function assetURL(version, filename) {
  return `https://github.com/${REPO}/releases/download/v${version}/${filename}`;
}

async function downloadFile(url, destPath, chalk, label) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'artifact-to-pwa' },
    redirect: 'follow',
    signal: AbortSignal.timeout(3 * 60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${label}`);

  const total   = parseInt(res.headers.get('content-length') || '0', 10);
  const totalKB = (total / 1024).toFixed(0);
  let downloaded = 0;
  const BAR = 20;

  const dest   = createWriteStream(destPath);
  const reader = res.body.getReader();
  const write  = chunk => new Promise((res, rej) => dest.write(chunk, e => e ? rej(e) : res()));

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await write(value);
    downloaded += value.length;
    if (total > 0) {
      const filled = Math.round((downloaded / total) * BAR);
      const bar    = '\u2588'.repeat(filled) + '\u2591'.repeat(BAR - filled);
      const kb     = (downloaded / 1024).toFixed(0);
      process.stdout.write(`\r  ${chalk.gray(`[${bar}]`)} ${chalk.white(`${kb} / ${totalKB} KB`)}  ${chalk.gray(label)}`);
    }
  }
  if (total > 0) process.stdout.write('\n');
  await new Promise((res, rej) => dest.end(e => e ? rej(e) : res()));
}

export async function ensureShell(chalk) {
  let version;
  try { version = await resolveLatestVersion(); }
  catch (err) { throw new Error(`Could not resolve Neutralino version: ${err.message}`); }

  const cacheDir      = join(CACHE_ROOT, `v${version}`);
  const binPath       = join(cacheDir, 'neutralino-win_x64.exe');
  const clientLibPath = join(cacheDir, 'neutralino.js');

  if (existsSync(binPath) && existsSync(clientLibPath)) {
    console.log(chalk.gray('  \u21b3 Runtime   ') + chalk.white(`Neutralino v${version}`) + chalk.gray(' (cached)'));
    return { binPath, clientLibPath, version };
  }

  console.log(chalk.gray('  \u21b3 Runtime   ') + chalk.white(`Neutralino v${version}`) + chalk.gray(' \u2014 downloading...'));
  mkdirSync(cacheDir, { recursive: true });

  try {
    await downloadFile(assetURL(version, 'neutralino-win_x64.exe'), binPath,       chalk, 'neutralino-win_x64.exe');
    await downloadFile(assetURL(version, 'neutralino.js'),          clientLibPath, chalk, 'neutralino.js');
  } catch (err) {
    throw new Error(`Failed to download Neutralino assets:\n  ${err.message}`);
  }

  if (!existsSync(binPath) || !existsSync(clientLibPath)) {
    throw new Error(`Download finished but files missing in ${cacheDir}`);
  }

  return { binPath, clientLibPath, version };
}
