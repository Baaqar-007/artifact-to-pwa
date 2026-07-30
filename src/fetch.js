/**
 * URL handler — v2.1.0
 * Fix #1: URL support deprecated — throws with actionable instructions
 */

export async function fetchURL(url) {
  throw new Error(
    `URL input was removed in v2.1.0.\n\n` +
    `  Anthropic's servers block direct scraping via X-Frame-Options headers,\n` +
    `  making URL conversion unreliable for all artifact URLs.\n\n` +
    `  How to convert a Claude artifact in 3 steps:\n\n` +
    `    1. Open your artifact in Claude\n` +
    `    2. Click the \`<>\` (source code) button in the artifact toolbar,\n` +
    `       then copy-paste into a file  (save as .jsx or .html)\n` +
    `    3. Run:  npx artifact-to-pwa ./your-artifact.jsx --name "My App"\n\n` +
    `  Supported file formats: .html  .jsx  .js  .tsx\n`
  );
}
