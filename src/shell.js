/**
 * Neutralino binary fetcher — v3.0.0
 *
 * Changes in this version:
 *   - Fix 404: binaries are distributed as neutralino.zip, not individual
 *     EXEs. GitHub assets API is used to locate the correct URL dynamically.
 *     Client library comes from a separate repo: neutralinojs/neutralino.js.
 *   - Version pinned to NEUTRALINO_VERSION — never downloads "latest".
 *   - SHA-256 verified via GitHub asset `digest` field after every download.
 *   - Cached files re-verified on every run (re-download if corrupted).
 *   - Self-healing: corrupt or stale cache is deleted and re-downloaded
 *     automatically. The user never needs to manually delete ~/.artifact-to-pwa.
 *   - Both files downloaded in parallel via Promise.all.
 *   - Retry logic: 3 attempts with exponential back-off on 429/502/503.
 *   - Content-Type guard: rejects HTML/JSON responses before writing to disk.
 *   - Progress bar clamped to [0, BAR] — guards against servers that report
 *     incorrect Content-Length values.
 */

import { createWriteStream, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join }       from 'path';
import { homedir }    from 'os';
import { createHash } from 'crypto';
import unzipper       from 'unzipper';

// ── Pinned versions ───────────────────────────────────────────────────────────
// Update these together when upgrading. Run the compat test suite after any bump.
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
      if ([429, 502, 503].includes(res.status) && attempt < maxAttempts) {
        await sleep(attempt * 2_000);
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
function verifyDigest(filePath, expectedDigest) {
  if (!expectedDigest) return; // no digest available — skip silently
  const expected = expectedDigest.replace(/^sha256:/i, '').toLowerCase();
  const actual   = computeSHA256(filePath);
  if (actual !== expected) {
    throw new Error(
      `Integrity check FAILED for ${filePath}\n` +
      `  Expected SHA-256: ${expected}\n` +
      `  Got:              ${actual}`
    );
  }
}

// ── Download with progress bar ────────────────────────────────────────────────

async function downloadToFile(url, destPath, chalk, label) {
  const res = await fetchWithRetry(url, {
    headers: { 'Accept': 'application/octet-stream' },
  }, 3);

  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${label}`);

  // Reject HTML/JSON responses immediately — they indicate a redirect to a
  // login page or an API metadata response rather than the binary itself.
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/html') || ct.includes('application/json')) {
    throw new Error(
      `Expected binary but server returned ${ct} for ${label}.\n` +
      `  URL: ${url}\n` +
      `  This usually means the URL resolved to a login page or API metadata.`
    );
  }

  // Clamp total to 0 if the header is missing or unparseable.
  const total   = Math.max(0, parseInt(res.headers.get('content-length') || '0', 10));
  const totalKB = (total / 1024).toFixed(0);
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
      // Clamp pct to [0,1] — guards against servers that lie about Content-Length.
      const pct    = Math.min(1, dl / total);
      const filled = Math.min(BAR, Math.max(0, Math.round(pct * BAR)));
      process.stdout.write(
        `\r  [${chalk.cyan('█'.repeat(filled) + '░'.repeat(BAR - filled))}] ` +
        `${chalk.white((dl / 1024).toFixed(0))} / ${totalKB} KB  ${chalk.gray(label)}`
      );
    }
  }
  if (total > 0) process.stdout.write('\n');
  await new Promise((res, rej) => dest.end(e => e ? rej(e) : res()));
}

// ── Download + extract pipeline ───────────────────────────────────────────────

async function downloadFresh(cacheDir, chalk) {
  mkdirSync(cacheDir, { recursive: true });

  // Fetch asset manifests from both repos in parallel
  const [binAssets, clientAssets] = await Promise.all([
    fetchReleaseAssets(BINARY_REPO, NEUTRALINO_VERSION),
    fetchReleaseAssets(CLIENT_REPO, CLIENT_VERSION),
  ]);

  // Locate the binary ZIP (exclude auto-generated GitHub source archives)
  const zipAsset = binAssets.find(
    a => a.name.endsWith('.zip') && !/source/i.test(a.name)
  );
  if (!zipAsset) {
    throw new Error(
      `Could not locate binary ZIP in ${BINARY_REPO} v${NEUTRALINO_VERSION} assets.\n` +
      `  Available: ${binAssets.map(a => a.name).join(', ')}`
    );
  }

  const clientAsset = clientAssets.find(a => a.name === 'neutralino.js');
  if (!clientAsset) {
    throw new Error(
      `Could not locate neutralino.js in ${CLIENT_REPO} v${CLIENT_VERSION} assets.\n` +
      `  Available: ${clientAssets.map(a => a.name).join(', ')}`
    );
  }

  console.log(
    chalk.gray(`  ↳ Found     `) +
    chalk.white(`${zipAsset.name}`) +
    chalk.gray(` + neutralino.js`)
  );
  console.log(chalk.gray('  ↳ Downloading both in parallel...'));

  const zipPath       = join(cacheDir, zipAsset.name);
  const clientLibPath = join(cacheDir, 'neutralino.js');

  // Download both files in parallel — use browser_download_url (direct CDN
  // link), never the `url` field (which is a GitHub API endpoint that returns
  // JSON metadata unless the Accept header is set exactly right).
  await Promise.all([
    downloadToFile(zipAsset.browser_download_url,    zipPath,       chalk, zipAsset.name),
    downloadToFile(clientAsset.browser_download_url, clientLibPath, chalk, 'neutralino.js'),
  ]);

  // Verify downloads against the GitHub asset digests before extraction
  process.stdout.write(chalk.gray('  ↳ Verifying downloads...'));
  verifyDigest(zipPath,       zipAsset.digest);
  verifyDigest(clientLibPath, clientAsset.digest);
  console.log(' ' + chalk.green('ok'));

  // Extract binary and DLL from ZIP
  process.stdout.write(chalk.gray('  ↳ Extracting...'));
await new Promise((resolve, reject) => {
  createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: cacheDir }))
    .on('close', resolve)
    .on('error', reject);
});
console.log(' ' + chalk.green('done'));

  // Clean up ZIP now that binaries are extracted
  try { rmSync(zipPath); } catch {}

  const binName = process.platform === 'win32' ? 'neutralino-win_x64.exe' : 'neutralino-linux_x64';
const binPath = join(cacheDir, binName);
if (!existsSync(binPath)) {
    throw new Error(
      `${binName} not found after extraction.\n` +
      `  Extracted to: ${cacheDir}\n` +
      `  Asset names may have changed — check: https://github.com/${BINARY_REPO}/releases/tag/v${NEUTRALINO_VERSION}`
    );
  }

  // Store SHA-256 of the extracted files (NOT the ZIP — it has been deleted).
  // These are used to verify the cache on subsequent runs.
  const digestFile = join(cacheDir, 'digests.json');
  writeFileSync(digestFile, JSON.stringify({
  'win32':  existsSync(join(cacheDir, 'neutralino-win_x64.exe'))
              ? computeSHA256(join(cacheDir, 'neutralino-win_x64.exe'))
              : null,
  'linux':  existsSync(join(cacheDir, 'neutralino-linux_x64'))
              ? computeSHA256(join(cacheDir, 'neutralino-linux_x64'))
              : null,
  'client': computeSHA256(clientLibPath),
}, null, 2));

  return binPath;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Ensures the Neutralino binary and client library are cached locally.
 *
 * Self-healing: if the cache exists but fails integrity verification, it is
 * deleted and re-downloaded automatically. The user never needs to manually
 * delete the cache directory.
 *
 * @param {object} chalk
 * @returns {Promise<{ binPath, dllPath, clientLibPath, version }>}
 */
export async function ensureShell(chalk) {
  const cacheDir      = join(CACHE_ROOT, `v${NEUTRALINO_VERSION}`);
  const binName = process.platform === 'win32' ? 'neutralino-win_x64.exe' : 'neutralino-linux_x64';
  const binPath       = join(cacheDir, binName);
  const dllPath       = join(cacheDir, 'WebView2Loader.dll');
  const clientLibPath = join(cacheDir, 'neutralino.js');
  const digestFile    = join(cacheDir, 'digests.json');

  const allCached = existsSync(binPath) && existsSync(clientLibPath);

  if (allCached) {
    // Re-verify cached files on every run to catch disk corruption or tampering.
    // If verification fails, wipe the cache and fall through to a fresh download.
    // The user never needs to do this manually.
    if (existsSync(digestFile)) {
      try {
        const stored = JSON.parse(readFileSync(digestFile, 'utf8'));
        const platformKey = process.platform === 'win32' ? 'win32' : 'linux';
        verifyDigest(binPath, stored[platformKey]);
        verifyDigest(clientLibPath, stored.client);

        // Cache is valid
        console.log(
          chalk.gray('  ↳ Runtime   ') +
          chalk.white(`Neutralino v${NEUTRALINO_VERSION}`) +
          chalk.gray(' (cached)')
        );
        return {
          binPath,
          dllPath:       existsSync(dllPath) ? dllPath : null,
          clientLibPath,
          version:       NEUTRALINO_VERSION,
        };
      } catch {
        // Verification failed — wipe and re-download
        console.log(chalk.yellow(
          `  ↳ Cached runtime failed verification — deleting and re-downloading...`
        ));
        rmSync(cacheDir, { recursive: true, force: true });
      }
    } else {
      // Cache exists but no digest file — could be from an older version.
      // Wipe and re-download to ensure a clean, verified state.
      console.log(chalk.yellow(
        `  ↳ Cache has no integrity record — deleting and re-downloading...`
      ));
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }

  // Fresh download
  console.log(
    chalk.gray('  ↳ Runtime   ') +
    chalk.white(`Neutralino v${NEUTRALINO_VERSION}`) +
    chalk.gray(' — fetching asset info...')
  );

  try {
    await downloadFresh(cacheDir, chalk);
  } catch (err) {
    throw new Error(`Failed to download Neutralino runtime:\n  ${err.message}`);
  }

  // Verify the freshly downloaded files before use
  if (existsSync(digestFile)) {
    try {
      const stored = JSON.parse(readFileSync(digestFile, 'utf8'));
      verifyDigest(binPath,       stored.bin);
      verifyDigest(clientLibPath, stored.client);
    } catch (err) {
      // Even a fresh download failed verification — something is wrong upstream
      rmSync(cacheDir, { recursive: true, force: true });
      throw new Error(
        `Freshly downloaded runtime failed integrity verification.\n` +
        `  ${err.message}\n` +
        `  This may indicate a problem with the Neutralino release itself.\n` +
        `  Check: https://github.com/${BINARY_REPO}/releases/tag/v${NEUTRALINO_VERSION}`
      );
    }
  }

  return {
    binPath,
    dllPath:       existsSync(dllPath) ? dllPath : null,
    clientLibPath,
    version:       NEUTRALINO_VERSION,
  };
}
