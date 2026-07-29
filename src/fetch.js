/**
 * URL fetcher — downloads HTML at build time (no iframe).
 * Provides clear manual-fallback instructions on bot-protection responses.
 */

export async function fetchURL(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(
      `Request timed out (30s).\n\n` +
      `  Manual fallback:\n    1. Open ${url} in Chrome\n` +
      `    2. Ctrl+S \u2192 "Webpage, HTML Only"\n` +
      `    3. npx artifact-to-pwa ./saved.html --name "My App"`
    );
    throw new Error(`Network error: ${err.message}`);
  }

  if ([401, 403, 429].includes(res.status)) throw new Error(
    `HTTP ${res.status} \u2014 page may require login or bot challenge.\n\n` +
    `  Manual fallback:\n    1. Open ${url} in Chrome\n` +
    `    2. Ctrl+S \u2192 "Webpage, HTML Only"\n` +
    `    3. npx artifact-to-pwa ./downloaded.html --name "My App"\n\n` +
    `  CDP auto-bypass is planned for v2.1.`
  );

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from: ${url}`);

  const html = await res.text();
  if (!html.trim()) throw new Error(`URL returned an empty response: ${url}`);
  return html;
}
