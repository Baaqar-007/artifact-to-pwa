# artifact-to-pwa — v3.0.0 branch (feat/neutralino)

> Work in progress on the `feat/neutralino` branch. See `main` for the published version.

## Runtime versions (pinned)

| Component | Pinned version |
|-----------|----------------|
| Neutralino binary | 6.7.0 |
| Neutralino client | 6.7.0 |
| React | 18.3.1 |
| react-dom | 18.3.1 |

## What changed in v3.0.0

- **Fix 404**: Download `neutralino.zip` via GitHub assets API; extract Windows exe + `WebView2Loader.dll`.
- **Pin versions**: Neutralino 6.7.0 and React 18.3.1 — no more `latest` in ephemeral installs.
- **SHA-256 verification**: Verified using GitHub asset `digest` field; cached files re-verified on every run.
- **Parallel + retry downloads**: Both Neutralino assets download simultaneously; 3 retries with exponential back-off.
- **Hash-based npm cache**: Each dependency set gets its own cache directory keyed by SHA-256.
- **detect.js module**: React detection, import extraction, and stripping separated from bundle.js.
- **Unsupported import errors**: Node built-ins and server-side packages surface clear, actionable errors with Neutralino API alternatives.
- **WebView2Loader.dll**: Copied alongside the exe when present in the Neutralino ZIP.
- **Compat test suite**: `npm test` — covers detect logic, unsupported imports, and representative artifact patterns.
- **UNSUPPORTED.md**: Full documentation of unsupported features and browser-safe alternatives.
