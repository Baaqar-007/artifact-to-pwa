
/**
 * Detects the type of artifact source code and wraps it into a complete,
 * self-contained HTML document.
 *
 * v2 changes vs v1:
 *   - Removed localStorage→IndexedDB shim (replaced by data portability widget)
 *   - Removed service worker injection (not needed for single local file)
 *   - Removed manifest injection (PWA install requires HTTPS hosting anyway)
 *   - Cleaner wrapping with explicit empty-output guard
 */

export function detectCodeType(code) {
  const t = code.trim();

  if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) {
    return 'full-html';
  }

  const reactSignals = [
    /from ['"]react['"]/,
    /import\s+React/,
    /export\s+default\s+function/,
    /export\s+default\s+class/,
    /useState\s*[(<]/,
    /useEffect\s*\(/,
    /React\.createElement/,
    /return\s*\(\s*</,
    /<>\s*</,
  ];

  if (reactSignals.some(re => re.test(t))) return 'react';
  if (/^<[a-zA-Z]/.test(t)) return 'html-fragment';
  return 'html-fragment';
}

export function wrapCode(code, { appName, themeColor }) {
  if (!code || !code.trim()) {
    throw new Error('Source code is empty — nothing to wrap.');
  }

  const type = detectCodeType(code);

  const baseMeta = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="theme-color" content="${themeColor}">`,
    `<title>${appName}</title>`,
  ].join('\n  ');

  if (type === 'full-html') {
    let result = code;
    if (/<title>/i.test(result)) {
      result = result.replace(/<title>[^<]*<\/title>/i, `<title>${appName}</title>`);
    } else if (/<\/head>/i.test(result)) {
      result = result.replace(/<\/head>/i, `  <title>${appName}</title>\n</head>`);
    }
    if (!result.includes('theme-color') && /<\/head>/i.test(result)) {
      result = result.replace(
        /<\/head>/i,
        `  <meta name="theme-color" content="${themeColor}">\n</head>`
      );
    }
    return result;
  }

  if (type === 'react') {
    let cleaned = code
      .replace(/^import\s+React[^;]*;\s*/gm, '')
      .replace(/^import\s*\{[^}]+\}\s*from\s*['"]react['"];\s*/gm, '')
      .replace(/^import\s*\*\s*as\s*React[^;]*;\s*/gm, '')
      .trim();

    cleaned = cleaned
      .replace(/^export\s+default\s+function\s+(\w+)/, 'function __App')
      .replace(/^export\s+default\s+class\s+(\w+)/, 'class __App')
      .replace(/^export\s+default\s+/, 'const __App = ');

    const hasApp = /\b__App\b/.test(cleaned);
    const renderLine = hasApp
      ? `ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__App));`
      : `/* artifact-to-pwa: could not detect a default export — add a render call manually */`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  ${baseMeta}
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html, body, #root { height: 100%; margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
const {
  useState, useEffect, useRef, useCallback,
  useMemo, useReducer, useContext, createContext
} = React;

${cleaned}

${renderLine}
  </script>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${baseMeta}
</head>
<body>
${code}
</body>
</html>`;
}
