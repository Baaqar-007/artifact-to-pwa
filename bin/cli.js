#!/usr/bin/env node
import { program } from 'commander';
import { build }   from '../src/build.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

program
  .name('artifact-to-pwa')
  .description(
    'Convert a Claude artifact (HTML / React / JSX) or any public URL into a\n' +
    'native Windows .exe — no Rust, no compiler, no App Store.\n\n' +
    'Examples:\n' +
    '  npx artifact-to-pwa ./my-app.jsx\n' +
    '  npx artifact-to-pwa https://claude.site/artifacts/abc123\n' +
    '  npx artifact-to-pwa ./app.jsx --name "My Tool" --icon ./icon.png'
  )
  .version(pkg.version)
  .argument('<source>', 'Local file path (.html, .jsx, .js) or public URL')
  .option('-n, --name <name>',  'App name (default: derived from filename or URL)')
  .option('-c, --color <hex>',  'Theme color',              '#6366f1')
  .option('-i, --icon <path>',  'Path to a .png icon file')
  .option('-o, --out <dir>',    'Output directory           (default: ./<slug>-windows)')
  .action(async (source, options) => {
    const { default: chalk } = await import('chalk');
    await build(source, options, chalk);
  });

program.parse();
