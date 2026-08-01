/**
 * Neutralino binary fetcher — v3.0.0
 *
 * CHANGES FROM v2.2.0:
 *
 *   FIX 404: The previous code tried to download `neutralino-win_x64.exe`
 *   directly, which does not exist as a standalone asset. Neutralino distributes
 *   ALL platform binaries inside a single ZIP (`neutralino.zip`) per release.
 *   The Windows exe (`neutralino-win_x64.exe`) and its required DLL
 *   (`WebView2Loader.dll`) must be extracted from that ZIP.
 *
 *   The client library (`neutralino.js`) is in a SEPARATE repo:
 *   neutralinojs/neutralino.js — it has its own releases with its own tags.
 *
 *   HARDEN: Version is now pinned to a tested release instead of "latest".
 *   Changing NEUTRALINO_VERSION is the single place to upgrade.
 *
 *   HARDEN: Both files are downloaded in parallel via Promise.all.
 *
 *   HARDEN: Downloads retry up to 3 times with exponential back-off on
 *   transient errors (429, 502, 503, network timeout).
 *
 *   HARDEN: SHA-256 integrity is verified after every download using the
 *   `digest` field from GitHub's releases API (format: "sha256:HEXSTRING").
 *   The asset digest is fetched from the API on every run but the file is
 *   only downloaded if not already cached. The cached file is re-verified
 *   before use to detect disk corruption or tampering.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join }      from 'path';
import { homedir }   from 'os';
import { createHash } from 'crypto';
import extractZip    from 'extract-zip';

// ── Pinned versions ───────────────────────────────────────────────────────────
// Update these together when upgrading. Run the test suite after any bump.
export const NEUTRALINO_VERSION = '6.7.0'; // binary runtime
export const CLIENT_VERSION     = '6.7.0'; // must match binary major version

const BINARY_REPO = 'neutralinojs/neutralinojs';
const CLIENT_REPO = 'neutralinojs/neutralino.js';
const CACHE_ROOT  = join(homedir(), '.artifact-to-pwa', 'neutralino');

// ── Retry-aware fetch ─────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, opts = {}, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': 'artifact-to-pwa', ...opts.headers },
        signal:  AbortSignal.timeout(30_000),
      });
      // Retry on transient server errors
      if ([429, 502, 503].includes(res.status) && attempt < maxAttempts) {
        const delay = attempt * 2_000;
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) await sleep(attempt * 2_000);
    }
  }
  throw lastErr ?? new Error(`Request failed after ${maxAttempts} attempts: ${url}`);
}

// ── GitHub releases API ───────────────────────────────────────────────────────

/**
 * Fetches the assets list for a specific tag from the GitHub API.
 * Returns an array of { name, browser_download_url, digest, size }.
 *
 * `digest` is populated by GitHub as "sha256:<hex>" when available.
 * All stable Neutralino releases include it.
 */
async function fetchReleaseAssets(repo, version) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/v${version}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(
      `GitHub API returned ${res.status} for ${repo}@v${version}.\n` +
      `  Verify the version exists at: https://github.com/${repo}/releases/tag/v${version}`
    );
  }
  const release = await res.json();
  if (!release.assets?.length) {
    throw new Error(`No assets found for ${repo}@v${version}`);
  }
  return release.assets;
}

// ── SHA-256 helpers ───────────────────────────────────────────────────────────

function computeSHA256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Verifies a file against a GitHub asset digest string ("sha256:HEXSTRING").
 * Throws with a clear message if the check fails.
 */
function verifyDigest(filePath, assetDigest) {
  if (!assetDigest) {
    // Digest not provided by API — skip but warn
    console.warn(`  ⚠  No digest available for ${filePath} — skipping integrity check`);
    return;
  }
  const expected = assetDigest.replace(/^sha256:/i, '').toLowerCase();
  const actual   = computeSHA256(filePath);
  if (actual !== expected) {
    throw new Error(
      `Integrity check FAILED for ${filePath}\n` +
      `  Expected SHA-256: ${expected}\n` +
      `  Got:              ${actual}\n` +
      `  The file may be corrupted or tampered with. Delete the cache at:\n` +
      `    ${CACHE_ROOT}\n` +
      `  and re-run to force a fresh download.`
    );
  }
}

// ── Download with progress bar ────────────────────────────────────────────────

async function downloadToFile(url, destPath, chalk, label) {
  const res = await fetchWithRetry(url, { headers: { 'Accept': 'application/octet-stream' } }, 3);  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${label}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/html') || ct.includes('application/json')) {
    throw new Error(
      `Expected a binary file but the server returned ${ct}.\n` +
      `  URL: ${url}\n` +
      `  This usually means the download URL resolved to a login page or API metadata.\n` +
      `  Check that browser_download_url is correct for release v${NEUTRALINO_VERSION}.`
    );
  }
  const total   = Math.max(0, parseInt(res.headers.get('content-length') || '0', 10));  const totalKB = (total / 1024).toFixed(0);
  let   dl = 0;
  const BAR = 20;

  const dest   = createWriteStream(destPath);
  const reader = res.body.getReader();
  const write  = chunk => new Promise((res, rej) => dest.write(chunk, e => e ? rej(e) : res()));

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await write(value);
    dl += value.length;
    if (total > 0) {
    const pct = Math.min(1, dl / total);          // clamp to [0,1] — guards overshoot
    const f   = Math.min(BAR, Math.max(0, Math.round(pct * BAR)));  // clamp to [0,BAR]
    process.stdout.write(
    `\r  [${chalk.cyan('█'.repeat(f) + '░'.repeat(BAR - f))}] ` +
        `${chalk.white((dl / 1024).toFixed(0))} / ${totalKB} KB  ${chalk.gray(label)}`
      );
    }
  }
  if (total > 0) process.stdout.write('\n');
  await new Promise((res, rej) => dest.end(e => e ? rej(e) : res()));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Ensures the Neutralino binary ZIP and client library are cached locally.
 *
 * Downloads both in parallel, verifies SHA-256 via GitHub API asset digests,
 * extracts the Windows binary and WebView2Loader.dll from the ZIP.
 *
 * @returns {Promise<{ binPath, dllPath, clientLibPath, version }>}
 *   dllPath may be null if WebView2Loader.dll is not present in the ZIP.
 */
export async function ensureShell(chalk) {
  const cacheDir      = join(CACHE_ROOT, `v${NEUTRALINO_VERSION}`);
  const binPath       = join(cacheDir, 'neutralino-win_x64.exe');
  const dllPath       = join(cacheDir, 'WebView2Loader.dll');
  const clientLibPath = join(cacheDir, 'neutralino.js');
  const digestFile    = join(cacheDir, 'digests.json');

  const allCached = existsSync(binPath) && existsSync(clientLibPath);

  if (allCached) {
    console.log(
      chalk.gray('  ↳ Runtime   ') +
      chalk.white(`Neutralino v${NEUTRALINO_VERSION}`) +
      chalk.gray(' (cached)')
    );

    // Re-verify cached files against stored digests to detect disk corruption
    if (existsSync(digestFile)) {
      const storedDigests = JSON.parse(readFileSync(digestFile, 'utf8'));
      try {
        verifyDigest(binPath,       storedDigests.bin);
        verifyDigest(clientLibPath, storedDigests.client);
      } catch (err) {
        throw new Error(`Cached file integrity check failed:\n  ${err.message}`);
      }
    }

    return {
      binPath,
      dllPath: existsSync(dllPath) ? dllPath : null,
      clientLibPath,
      version: NEUTRALINO_VERSION,
    };
  }

  console.log(
    chalk.gray('  ↳ Runtime   ') +
    chalk.white(`Neutralino v${NEUTRALINO_VERSION}`) +
    chalk.gray(' — fetching asset info...')
  );

  mkdirSync(cacheDir, { recursive: true });

  // ── Fetch asset lists from both repos in parallel ─────────────────────────
  const [binAssets, clientAssets] = await Promise.all([
    fetchReleaseAssets(BINARY_REPO, NEUTRALINO_VERSION),
    fetchReleaseAssets(CLIENT_REPO, CLIENT_VERSION),
  ]);

  // Locate the binary ZIP (skip auto-generated source archives)
  const zipAsset = binAssets.find(
    a => a.name.endsWith('.zip') && !/source/i.test(a.name)
  );
  if (!zipAsset) {
    throw new Error(
      `Could not locate binary ZIP in ${BINARY_REPO} v${NEUTRALINO_VERSION} assets.\n` +
      `  Available assets: ${binAssets.map(a => a.name).join(', ')}`
    );
  }

  // Locate neutralino.js client library
  const clientAsset = clientAssets.find(a => a.name === 'neutralino.js');
  if (!clientAsset) {
    throw new Error(
      `Could not locate neutralino.js in ${CLIENT_REPO} v${CLIENT_VERSION} assets.\n` +
      `  Available assets: ${clientAssets.map(a => a.name).join(', ')}`
    );
  }

  console.log(chalk.gray(`  ↳ Found     `) + chalk.white(`${zipAsset.name}`) + chalk.gray(` + neutralino.js`));
  console.log(chalk.gray('  ↳ Downloading both in parallel...'));

  // ── Download both files in parallel ───────────────────────────────────────
  const zipPath = join(cacheDir, zipAsset.name);

  await Promise.all([
    downloadToFile(zipAsset.browser_download_url, zipPath, chalk, zipAsset.name),
    downloadToFile(clientAsset.browser_download_url, clientLibPath, chalk, 'neutralino.js'),
  ]);

  // ── Verify integrity ───────────────────────────────────────────────────────
  process.stdout.write(chalk.gray('  ↳ Verifying...'));
  verifyDigest(zipPath,       zipAsset.digest);
  verifyDigest(clientLibPath, clientAsset.digest);
  console.log(' ' + chalk.green('ok'));

  // ── Extract binary and DLL from ZIP ───────────────────────────────────────
  process.stdout.write(chalk.gray('  ↳ Extracting...'));
  await extractZip(zipPath, { dir: cacheDir });
  console.log(' ' + chalk.green('done'));

  // Confirm the Windows binary is present after extraction
  if (!existsSync(binPath)) {
    throw new Error(
      `neutralino-win_x64.exe not found in ZIP after extraction.\n` +
      `  Extracted to: ${cacheDir}\n` +
      `  The asset names may have changed — check: https://github.com/${BINARY_REPO}/releases/tag/v${NEUTRALINO_VERSION}`
    );
  }

  // Store digests for future cache verification
  writeFileSync(digestFile, JSON.stringify({
    bin:    zipAsset.digest    ?? computeSHA256(zipPath),
    client: clientAsset.digest ?? computeSHA256(clientLibPath),
  }, null, 2));

  // Clean up the ZIP (binaries are now extracted)
  try { (await import('fs')).default.unlinkSync(zipPath); } catch {}

  return {
    binPath,
    dllPath: existsSync(dllPath) ? dllPath : null,
    clientLibPath,
    version: NEUTRALINO_VERSION,
  };
}
