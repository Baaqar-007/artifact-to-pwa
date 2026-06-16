import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { detectCodeType }                              from './detect.js';
import { hasLocalStorage }                             from './storage.js';
import { generateSVGIcon }                             from './icons.js';
import { buildIndexHTML, buildManifest, buildServiceWorker, buildReadme } from './templates.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const isURL = s => /^https?:\/\//i.test(s.trim());

/** Turn an arbitrary string into a lowercase URL slug. */
const slugify = s =>
  s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');

/** Derive a human-readable app name from a path or URL. */
function nameFromSource(source) {
  if (isURL(source)) {
    try {
      const host = new URL(source).hostname.replace(/^www\./, '');
      const part = host.split('.')[0];
      return part.charAt(0).toUpperCase() + part.slice(1);
    } catch {
      return 'My App';
    }
  }
  const base = basename(source, extname(source));
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Orchestrates PWA generation from a CLI invocation.
 *
 * @param {string} source  - File path or URL
 * @param {object} options - Commander option values
 */
export async function generatePWA(source, options) {
  // ── Lazy-load chalk (ESM-only package) ──────────────────────────────────
  const { default: chalk } = await import('chalk');

  console.log('\n' + chalk.bold.cyan('  artifact-to-pwa') + chalk.gray(' — PWA generator\n'));

  // ── Resolve config ──────────────────────────────────────────────────────
  const appName   = (options.name || nameFromSource(source)).trim();
  const shortName = (options.shortName || appName).slice(0, 12).trim();
  const slug      = slugify(appName) || 'my-pwa';
  const outDir    = options.out || `./${slug}-pwa`;
  const themeColor = /^#[0-9a-f]{3,6}$/i.test(options.color || '') ? options.color : '#6366f1';
  const bgColor    = /^#[0-9a-f]{3,6}$/i.test(options.bg    || '') ? options.bg    : '#ffffff';

  // ── Print plan ──────────────────────────────────────────────────────────
  console.log(chalk.gray('  App name  ') + chalk.white(appName));
  console.log(chalk.gray('  Output    ') + chalk.white(outDir));
  console.log(chalk.gray('  Color     ') + chalk.white(themeColor));
  console.log(chalk.gray('  Source    ') + chalk.white(source));
  console.log();

  // ── Resolve source content ──────────────────────────────────────────────
  let mode, code;

  if (isURL(source)) {
    mode = 'url';
    code = null;
    console.log(chalk.gray('  ↳ URL mode: artifact will be embedded via iframe'));
    console.log(chalk.gray('    (For offline support, paste the source code instead)\n'));
  } else {
    if (!existsSync(source)) {
      console.error(chalk.red(`\n  ✗ File not found: ${source}\n`));
      process.exit(1);
    }
    mode = 'code';
    code = readFileSync(source, 'utf8');
    const detectedType = detectCodeType(code);
    console.log(chalk.gray(`  ↳ Detected: `) + chalk.yellow(detectedType));

    // Warn + auto-fix localStorage usage
    if (hasLocalStorage(code)) {
      console.log(
        chalk.yellow('  ⚡ localStorage detected') +
        chalk.gray(' → auto-migrating to IndexedDB (data will persist across installs)')
      );
    }

    console.log();
  }

  // ── Build config object ─────────────────────────────────────────────────
  const config = {
    appName,
    shortName,
    description: options.description || '',
    themeColor,
    bgColor,
    slug,
    mode,
    code,
    url: source,
  };

  // ── Create output directory ─────────────────────────────────────────────
  mkdirSync(outDir, { recursive: true });

  // ── Write files ─────────────────────────────────────────────────────────
  const files = [
    ['index.html',    buildIndexHTML(config)],
    ['manifest.json', buildManifest(config)],
    ['sw.js',         buildServiceWorker(config)],
    ['icon.svg',      generateSVGIcon(themeColor, appName[0] || 'A')],
    ['README.md',     buildReadme(config)],
  ];

  for (const [filename, content] of files) {
    writeFileSync(join(outDir, filename), content, 'utf8');
    console.log(chalk.green('  ✓ ') + filename);
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log(
    '\n' +
    chalk.bold.white('  All done!\n') +
    chalk.gray('\n  Test locally:\n') +
    chalk.white(`    npx serve ${outDir}\n`) +
    chalk.gray('\n  Or drag ') +
    chalk.white(`'${outDir}/'`) +
    chalk.gray(' to ') +
    chalk.cyan('netlify.com/drop') +
    chalk.gray(' for instant hosting + mobile install.\n')
  );
}
