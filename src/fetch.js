
/**
 * Fetches HTML from a public URL at build time.
 *
 * v1 used an iframe to embed URLs — this broke silently because most pages
 * (including Claude artifacts) set X-Frame-Options or CSP headers that block
 * iframe embedding from other origins. v2 fetches the content during the build
 * and inlines it directly, so no iframe is needed at runtime.
 */

/**
 * Downloads HTML from a URL and returns it as a string.
 * Throws a descriptive error on any failure so the CLI can print it clearly.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchHTML(url) {
  let res;

  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'artifact-to-pwa/2.0 (https://github.com/Baaqar-007/artifact-to-pwa)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error(
        `Request timed out after 20 seconds.\n` +
        `  The server may be slow or the URL may not be publicly accessible.\n` +
        `  Try opening the URL in your browser, saving it as HTML, and using\n` +
        `  the file path instead: npx artifact-to-pwa ./saved.html`
      );
    }
    throw new Error(`Network error: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(
      `Server returned HTTP ${res.status} ${res.statusText}.\n` +
      `  URL: ${url}\n` +
      `  This usually means the page requires login, or the URL has expired.\n` +
      `  Open the page in your browser, save it as HTML (Ctrl+S / Cmd+S),\n` +
      `  then run: npx artifact-to-pwa ./saved.html`
    );
  }

  const html = await res.text();

  if (!html || !html.trim()) {
    throw new Error(`The URL returned an empty response: ${url}`);
  }

  return html;
}
