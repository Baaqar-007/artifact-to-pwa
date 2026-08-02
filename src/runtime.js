/**
 * Claude runtime compatibility shims — v3.0.0
 *
 * Claude exposes APIs on `window` that only exist inside its iframe runtime.
 * When an artifact is converted and run as a standalone Neutralino app, these
 * APIs are absent and any artifact that calls them silently fails.
 *
 * This module defines drop-in replacements backed by localStorage so converted
 * artifacts behave identically to running inside Claude.
 *
 * DESIGN RULES:
 *   - Every shim guards against overwriting Claude's native implementation.
 *     If window.X already exists, the shim is a no-op. This means the same
 *     bundle can be opened inside Claude (uses native) or as a standalone
 *     app (uses shim) without any code change.
 *
 *   - All shims are pure JavaScript strings that run in the WebView context.
 *     They are concatenated into a single <script> block and injected before
 *     any app code runs.
 *
 *   - To add a future shim: export a new SHIM_* constant below and add it
 *     to the SHIMS array in CLAUDE_RUNTIME_SHIM. Order matters: declare APIs
 *     that others depend on first.
 *
 * AUDITED Claude runtime APIs (as of 2025):
 *   window.storage        ← implemented below
 *   window.fs             ← not yet seen in artifacts; reserved for future
 *   window.claude         ← metadata object; no known artifact usage
 */

// ── window.storage ────────────────────────────────────────────────────────────
//
// Claude API contract (all methods async):
//
//   storage.get(key)          → Promise<{ value: string } | null>
//   storage.set(key, value)   → Promise<void>
//   storage.remove(key)       → Promise<void>
//   storage.clear()           → Promise<void>
//
// Important: get() returns { value: string } or null, NOT a raw string.
// Artifacts typically do: const result = await window.storage.get(key);
//                         if (result) use(result.value);
//
// Implementation: backed by localStorage, namespaced under "__cs__" to
// avoid colliding with any direct localStorage usage in the same artifact.

const SHIM_STORAGE = `
(function () {
  if (window.storage) return; // Claude native already present — do not overwrite

  var NS = '__cs__'; // namespace prefix for all keys written by this shim

  window.storage = {
    get: function (key) {
      var raw = localStorage.getItem(NS + key);
      return Promise.resolve(raw !== null ? { value: raw } : null);
    },

    set: function (key, value) {
      localStorage.setItem(NS + key, String(value));
      return Promise.resolve();
    },

    remove: function (key) {
      localStorage.removeItem(NS + key);
      return Promise.resolve();
    },

    clear: function () {
      var toDelete = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(NS) === 0) toDelete.push(k);
      }
      toDelete.forEach(function (k) { localStorage.removeItem(k); });
      return Promise.resolve();
    }
  };
}());`.trim();

// ── Aggregate shim block ──────────────────────────────────────────────────────
// All shims are combined into one <script> tag that is injected as the very
// first script in <head>, before the Neutralino bridge and before any app code.

const SHIMS = [
  SHIM_STORAGE,
  // Add future shims here, e.g.:
  // SHIM_FS,
  // SHIM_CLAUDE_METADATA,
];

export const CLAUDE_RUNTIME_SHIM = `<script>\n${SHIMS.join('\n\n')}\n</script>`;
