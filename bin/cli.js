#!/usr/bin/env node
/**
 * CLI entry point — v2.1.0
 * Fix #1: removed URL examples, updated description
 */

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
    'Convert a Claude artifact (.jsx / .html / .js) into a native Windows .exe\n' +
    'with persistent storage, offline bundling, and zero manual setup.\n\n' +
    'Examples:\n' +
    '  npx artifact-to-pwa ./my-app.jsx\n' +
    '  npx artifact-to-pwa ./app.html --name "My Tool"\n' +
    '  npx artifact-to-pwa ./app.jsx  --name "My Tool" --icon ./icon.png\n\n' +
    'To get your artifact file from Claude:\n' +
    '  Open the artifact → click the <> source button → save as .jsx or .html'
  )
  .version(pkg.version)
  .argument('<file>', 'Path to artifact file (.html, .jsx, .js, .tsx)')
  .option('-n, --name <name>',  'App name (default: derived from filename)')
  .option('-c, --color <hex>',  'Theme color',    '#6366f1')
  .option('-i, --icon <path>',  'Path to a .png icon file')
  .option('-o, --out <dir>',    'Output directory (default: ./<slug>-windows)')
  .action(async (source, options) => {
    const { default: chalk } = await import('chalk');
    await build(source, options, chalk);
  });

program.parse();
