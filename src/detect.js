/**
 * Detects whether a string of source code is:
 *   "full-html"     — a complete <!DOCTYPE html> document
 *   "html-fragment" — partial HTML without doctype/html tags
 *   "react"         — JSX / React component
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
    /=>\s*\(/,        // arrow fn returning JSX
    /<>\s*</,         // fragment shorthand
  ];

  if (reactSignals.some(re => re.test(t))) return 'react';

  // Looks like it starts with an HTML tag but has no doctype
  if (/^<[a-zA-Z]/.test(t)) return 'html-fragment';

  // Default: treat as an HTML fragment
  return 'html-fragment';
}

/**
 * Wraps source code into a complete, PWA-ready index.html.
 * Injects manifest link, theme-color meta, and SW registration.
 */
export function wrapCode(code, { appName, themeColor }) {
  const type = detectCodeType(code);

  const headInjects = `
  <meta name="theme-color" content="${themeColor}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="${appName}">
  <link rel="apple-touch-icon" href="icon.svg">
  <link rel="manifest" href="manifest.json">`.trim();

  const swScript = `
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () =>
      navigator.serviceWorker.register('sw.js').catch(() => {})
    );
  }
</script>`.trim();

  // ── Full HTML document ────────────────────────────────────────────────────
  if (type === 'full-html') {
    let result = code;

    // Inject into existing <head>
    if (/<\/head>/i.test(result)) {
      result = result.replace(/<\/head>/i, `  ${headInjects}\n</head>`);
    } else {
      // No </head>: inject after <html> or at top
      result = result.replace(/(<html[^>]*>)/i, `$1\n<head>\n  ${headInjects}\n</head>`);
    }

    // Inject SW before </body>
    if (/<\/body>/i.test(result)) {
      result = result.replace(/<\/body>/i, `  ${swScript}\n</body>`);
    } else {
      result += `\n${swScript}`;
    }

    return result;
  }

  // ── React / JSX ───────────────────────────────────────────────────────────
  if (type === 'react') {
    // Strip top-level React imports (provided by CDN)
    let cleaned = code
      .replace(/^import\s+React[^;]*;\s*/gm, '')
      .replace(/^import\s*\{[^}]+\}\s*from\s*['"]react['"];\s*/gm, '')
      .trim();

    // Normalize export default → __App
    cleaned = cleaned
      .replace(/^export\s+default\s+function\s+(\w+)/, 'function __App')
      .replace(/^export\s+default\s+class\s+(\w+)/, 'class __App')
      .replace(/^export\s+default\s+/, 'const __App = ');

    const hasApp = /\b__App\b/.test(cleaned);
    const renderLine = hasApp
      ? `ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__App));`
      : `/* Could not auto-detect root component — update the render call below */`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  ${headInjects}
  <!-- React + Babel (no build step) -->
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>html,body,#root{height:100%;margin:0;padding:0;}</style>
  ${swScript}
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

  // ── HTML fragment ─────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  ${headInjects}
  ${swScript}
</head>
<body>
${code}
</body>
</html>`;
}
