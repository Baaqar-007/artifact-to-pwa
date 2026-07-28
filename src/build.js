
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fetchHTML }                        from './fetch.js';
import { detectCodeType, wrapCode }         from './detect.js';
import { hasLocalStorage, getDataWidget }   from './widget.js';

const isURL = s => /^https?:\/\//i.test(String(s).trim());

const slugify = s =>
  String(s)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'my-app';

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

function injectBeforeBodyClose(html, snippet) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  }
  return html + '\n' + snippet;
}

export async function buildPWA(source, options, chalk) {
  console.log('\n' + chalk.bold.cyan('  artifact-to-pwa') + chalk.gray(' v2\n'));

  const appName    = ((options.name || nameFromSource(source)) + '').trim() || 'My App';
  const slug       = slugify(appName);
  const outFile    = (options.out || `./${slug}.html`).trim();
  const themeColor = /^#[0-9a-f]{3,6}$/i.test(options.color || '') ? options.color : '#6366f1';

  console.log(chalk.gray('  App     ') + chalk.white(appName));
  console.log(chalk.gray('  Output  ') + chalk.white(outFile));
  console.log(chalk.gray('  Source  ') + chalk.white(source));
  console.log();

  let html = '';

  if (isURL(source)) {
    process.stdout.write(chalk.gray('  ↳ Fetching...'));
    try {
      html = await fetchHTML(source);
      console.log(' ' + chalk.green('done') + chalk.gray(` (${(html.length / 1024).toFixed(1)} kB)`));
    } catch (err) {
      console.log(' ' + chalk.red('failed'));
      console.error('\n' + chalk.red('  ✗ ' + err.message) + '\n');
      process.exit(1);
    }
    if (/<title>/i.test(html)) {
      html = html.replace(/<title>[^<]*<\/title>/i, `<title>${appName}</title>`);
    } else if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `  <title>${appName}</title>\n</head>`);
    }
    if (!html.includes('theme-color') && /<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `  <meta name="theme-color" content="${themeColor}">\n</head>`);
    }
  } else {
    const absPath = resolve(source);
    if (!existsSync(absPath)) {
      console.error(chalk.red(`  ✗ File not found: ${source}\n`)); process.exit(1);
    }
    const stat = statSync(absPath);
    if (stat.size === 0) {
      console.error(chalk.red(`  ✗ File is empty: ${source}\n`)); process.exit(1);
    }
    let code;
    try {
      code = readFileSync(absPath, 'utf8');
    } catch (err) {
      console.error(chalk.red(`  ✗ Could not read file: ${err.message}\n`)); process.exit(1);
    }
    if (!code.trim()) {
      console.error(chalk.red(`  ✗ File contains only whitespace: ${source}\n`)); process.exit(1);
    }
    const type = detectCodeType(code);
    console.log(chalk.gray('  ↳ Type   ') + chalk.yellow(type));
    try {
      html = wrapCode(code, { appName, themeColor });
    } catch (err) {
      console.error(chalk.red(`  ✗ Build error: ${err.message}\n`)); process.exit(1);
    }
  }

  if (!html || !html.trim()) {
    console.error(chalk.red(
      '  ✗ Build produced empty output.\n' +
      '  Please open an issue at https://github.com/Baaqar-007/artifact-to-pwa\n'
    ));
    process.exit(1);
  }

  if (hasLocalStorage(html)) {
    html = injectBeforeBodyClose(html, getDataWidget());
    console.log(chalk.yellow('  ⚡ localStorage detected') + chalk.gray(' → 💾 Export / 📂 Import widget added'));
  }

  const outDir = dirname(resolve(outFile));
  mkdirSync(outDir, { recursive: true });

  try {
    writeFileSync(outFile, html, 'utf8');
  } catch (err) {
    console.error(chalk.red(`  ✗ Could not write output file: ${err.message}\n`)); process.exit(1);
  }

  const written = readFileSync(outFile, 'utf8');
  if (!written.trim()) {
    console.error(chalk.red(`  ✗ Output file is empty after write — possible disk issue.\n`)); process.exit(1);
  }

  const sizeKB = (Buffer.byteLength(written, 'utf8') / 1024).toFixed(1);
  console.log(
    '\n' + chalk.green('  ✓ ') + chalk.white(outFile) + chalk.gray(` (${sizeKB} kB)`) +
    '\n\n' + chalk.gray('  Open it:  ') + chalk.white(`double-click ${outFile}`) + '\n' +
    chalk.gray('  Or serve: ') + chalk.white(`npx serve .`) +
    chalk.gray('  then visit ') + chalk.cyan(`http://localhost:3000/${outFile.replace('./', '')}`) + '\n'
  );
}
