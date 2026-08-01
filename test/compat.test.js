/**
 * Compatibility test suite — v3.0.0
 *
 * Tests bundleFile() against representative Claude artifact patterns.
 * Run with: node --test test/compat.test.js
 *
 * Uses Node's built-in test runner (node:test), available since Node 18.
 * No extra test framework needed.
 *
 * Each test:
 *   1. Writes a minimal artifact source to a temp file
 *   2. Calls bundleFile() with a no-op spinner
 *   3. Asserts the output is valid HTML containing expected markers
 *
 * The localStorage persistence test verifies that the Neutralino bridge
 * script is injected (unit-level check; full WebView2 round-trip requires
 * a running Neutralino binary and is tested separately in CI).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, unlinkSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

// Minimal ora-compatible spinner stub so tests don't need ora installed
const spinner = { text: '', start: () => spinner, stop: () => spinner };

// Import the bundler (requires esbuild and npm to be available)
import { bundleFile } from '../src/bundle.js';
import { detectArtifactType, extractBareImports, stripReactImports } from '../src/detect.js';

// ── Temp file helpers ─────────────────────────────────────────────────────────

const TMP = join(tmpdir(), `atp-test-${Date.now()}`);
let   tempFiles = [];

function writeTemp(name, content) {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, content, 'utf8');
  tempFiles.push(p);
  return p;
}

after(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// ── detect.js unit tests ──────────────────────────────────────────────────────

describe('detectArtifactType', () => {
  it('recognises full HTML documents', () => {
    assert.equal(detectArtifactType('<!DOCTYPE html><html><body></body></html>'), 'full-html');
    assert.equal(detectArtifactType('<html lang="en"></html>'), 'full-html');
  });

  it('recognises React artifacts', () => {
    assert.equal(detectArtifactType(`import { useState } from 'react';
export default function App() { return <div />; }`), 'react');
    assert.equal(detectArtifactType(`export default function App() {
  return <><p>hello</p></>;
}`), 'react');
  });

  it('falls back to html-fragment', () => {
    assert.equal(detectArtifactType('<div>hello</div>'), 'html-fragment');
    assert.equal(detectArtifactType('<p>no doctype</p>'), 'html-fragment');
  });
});

describe('extractBareImports', () => {
  it('extracts third-party imports', () => {
    const code = `import { LineChart } from 'recharts';
import _ from 'lodash';
import { useState } from 'react';`;
    const imports = extractBareImports(code);
    assert.ok(imports.includes('recharts'), 'should find recharts');
    assert.ok(imports.includes('lodash'), 'should find lodash');
    assert.ok(!imports.includes('react'), 'should exclude react');
  });

  it('throws on Node.js built-in imports', () => {
    assert.throws(
      () => extractBareImports(`import fs from 'fs';`),
      /Node\.js built-in/
    );
    assert.throws(
      () => extractBareImports(`import { readFile } from 'fs/promises';`),
      /Node\.js built-in/
    );
  });

  it('throws on Express with explanation', () => {
    assert.throws(
      () => extractBareImports(`import express from 'express';`),
      /Node\.js server framework/
    );
  });

  it('throws on Electron APIs', () => {
    assert.throws(
      () => extractBareImports(`import { app } from 'electron';`),
      /Electron APIs/
    );
  });
});

describe('stripReactImports', () => {
  it('strips all React import forms', () => {
    const cases = [
      `import React from 'react';`,
      `import React, { useState } from 'react';`,
      `import { useState, useEffect } from 'react';`,
      `import * as React from 'react';`,
      `import ReactDOM from 'react-dom';`,
      `import { createRoot } from 'react-dom/client';`,
      `import * as ReactDOM from 'react-dom/client';`,
    ];
    for (const c of cases) {
      const stripped = stripReactImports(c).trim();
      assert.equal(stripped, '', `Expected empty string after stripping:\n  ${c}`);
    }
  });

  it('leaves non-React imports intact', () => {
    const code = `import { LineChart } from 'recharts';\nimport _ from 'lodash';`;
    const stripped = stripReactImports(code);
    assert.ok(stripped.includes('recharts'), 'recharts import should remain');
    assert.ok(stripped.includes('lodash'), 'lodash import should remain');
  });
});

// ── bundleFile integration tests ──────────────────────────────────────────────
// These call the actual bundler and require npm + esbuild to be installed.
// Skip if SKIP_BUNDLE_TESTS=1 (useful in environments without npm).

const SKIP = process.env.SKIP_BUNDLE_TESTS === '1';

describe('bundleFile — simple React', { skip: SKIP }, () => {
  it('bundles a minimal React component', async () => {
    const file = writeTemp('simple-react.jsx', `
import { useState } from 'react';
export default function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
`);
    const html = await bundleFile(file, { appName: 'Test', themeColor: '#000' }, spinner);
    assert.ok(html.includes('<!DOCTYPE html>'), 'should be a full HTML document');
    assert.ok(html.includes('neutralino.js'), 'should include Neutralino bridge');
    assert.ok(html.includes('<div id="root">'), 'should include React root');
    assert.ok(html.includes('<script>'), 'should include bundled JS');
  });
});

describe('bundleFile — Tailwind', { skip: SKIP }, () => {
  it('bundles a Tailwind-styled component', async () => {
    const file = writeTemp('tailwind.jsx', `
export default function App() {
  return <div className="flex items-center justify-center h-screen bg-gray-100">
    <h1 className="text-4xl font-bold text-blue-600">Hello Tailwind</h1>
  </div>;
}
`);
    const html = await bundleFile(file, { appName: 'Tailwind Test', themeColor: '#3b82f6' }, spinner);
    assert.ok(html.includes('neutralino.js'));
    assert.ok(html.includes('<!DOCTYPE html>'));
  });
});

describe('bundleFile — localStorage', { skip: SKIP }, () => {
  it('bundles an app that uses localStorage', async () => {
    const file = writeTemp('localstorage.jsx', `
import { useState, useEffect } from 'react';
export default function App() {
  const [val, setVal] = useState(() => localStorage.getItem('key') || '');
  useEffect(() => { localStorage.setItem('key', val); }, [val]);
  return <input value={val} onChange={e => setVal(e.target.value)} />;
}
`);
    const html = await bundleFile(file, { appName: 'LS Test', themeColor: '#000' }, spinner);
    assert.ok(html.includes('neutralino.js'), 'Neutralino bridge must be present for localStorage to use WebView2 profile');
    // WebView2 persists localStorage natively — no additional shim needed
    assert.ok(!html.includes('__electronAPI'), 'should NOT contain old Electron IPC shim');
    assert.ok(!html.includes('__pwaStorage'), 'should NOT contain old v1 shim');
  });
});

describe('bundleFile — full HTML passthrough', { skip: SKIP }, () => {
  it('passes full HTML through with Neutralino inject added', async () => {
    const file = writeTemp('full.html', `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><p>Hello</p></body>
</html>`);
    const html = await bundleFile(file, { appName: 'HTML Test', themeColor: '#000' }, spinner);
    assert.ok(html.includes('neutralino.js'), 'Neutralino bridge must be injected');
    assert.ok(html.includes('<p>Hello</p>'), 'original content must be preserved');
    assert.ok(html.includes('<title>Test</title>'), 'original title must be preserved');
  });
});

describe('bundleFile — CSS imports', { skip: SKIP }, () => {
  it('handles CSS imports (converts to inline strings)', async () => {
    const cssFile = writeTemp('styles.css', `.app { color: red; }`);
    const file = writeTemp('with-css.jsx', `
import './styles.css';
export default function App() { return <div className="app">Hello</div>; }
`);
    // Should not throw — CSS is loaded as a text string via esbuild loader
    const html = await bundleFile(file, { appName: 'CSS Test', themeColor: '#000' }, spinner);
    assert.ok(html.includes('<!DOCTYPE html>'));
  });
});

describe('bundleFile — image imports', { skip: SKIP }, () => {
  it('handles PNG imports (converts to data URLs)', async () => {
    // Create a minimal 1x1 PNG (89 bytes)
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex'
    );
    const imgFile = join(TMP, 'icon.png');
    writeFileSync(imgFile, pngBytes);

    const file = writeTemp('with-img.jsx', `
import icon from './icon.png';
export default function App() { return <img src={icon} alt="icon" />; }
`);
    const html = await bundleFile(file, { appName: 'Img Test', themeColor: '#000' }, spinner);
    assert.ok(html.includes('data:image/png'));
  });
});

describe('bundleFile — unsupported imports', () => {
  it('throws a human-readable error for Node fs import', () => {
    assert.throws(
      () => extractBareImports(`import { readFileSync } from 'fs';`),
      err => {
        assert.ok(err.message.includes('Node.js built-in'), 'error should mention Node.js built-in');
        assert.ok(err.message.includes('Neutralino.filesystem'), 'error should suggest Neutralino API');
        return true;
      }
    );
  });

  it('throws a human-readable error for express import', () => {
    assert.throws(
      () => extractBareImports(`import express from 'express';`),
      err => {
        assert.ok(err.message.includes('server framework'));
        assert.ok(err.message.includes('UNSUPPORTED.md'));
        return true;
      }
    );
  });
});
