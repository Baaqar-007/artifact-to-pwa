#!/usr/bin/env node
import { program } from 'commander';
import { generatePWA } from '../src/generator.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

program
  .name('artifact-to-pwa')
  .description(
    'Convert a Claude artifact (HTML/React/JSX) or any public URL into a ready-to-install PWA.\n\n' +
    'Examples:\n' +
    '  npx artifact-to-pwa ./my-app.jsx\n' +
    '  npx artifact-to-pwa https://claude.site/artifacts/abc123\n' +
    '  npx artifact-to-pwa ./app.html --name "My Tool" --color "#ff6b6b"'
  )
  .version(pkg.version)
  .argument('<source>', 'Local file path (.html, .jsx, .js) or public URL')
  .option('-n, --name <name>',        'App name (default: derived from filename or URL)')
  .option('-s, --short-name <name>',  'Short name shown on home screen (default: first 12 chars of name)')
  .option('-d, --description <text>', 'App description', '')
  .option('-c, --color <hex>',        'Theme / accent color',    '#6366f1')
  .option('-b, --bg <hex>',           'Splash screen background color', '#ffffff')
  .option('-o, --out <dir>',          'Output directory (default: ./<slug>-pwa)')
  .action(generatePWA);

program.parse();
