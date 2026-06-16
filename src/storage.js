/**
 * localStorage → IndexedDB bridge
 *
 * Problem: localStorage is tied to the page's origin (URL).
 * When an artifact is converted to a PWA and served from a new address,
 * it gets a fresh, empty localStorage — all saved data is lost.
 *
 * Solution: replace localStorage with an IndexedDB-backed shim that:
 *   1. Keeps reads synchronous via an in-memory mirror (same API, no refactor needed)
 *   2. Persists all writes to IndexedDB (survives installs, updates, reboots)
 *   3. Pre-populates the mirror on load, hiding the page briefly to prevent
 *      a flash of empty/default state before data is ready
 *
 * The shim is injected as the very first <script> in <head> so it runs
 * before any application code touches window.localStorage.
 */

/**
 * Returns true if the source string contains any localStorage usage.
 * @param {string} code
 */
export function hasLocalStorage(code) {
  return /localStorage/.test(code);
}

/**
 * Returns a self-contained <script> block that replaces window.localStorage
 * with an IndexedDB-backed shim. Safe to inject into any HTML document.
 */
export function getStorageShim() {
  return `<script>
/* ── artifact-to-pwa: localStorage → IndexedDB shim ── */
(function () {
  'use strict';

  var DB_NAME = '__pwa_storage__';
  var STORE   = 'kv';
  var mem     = Object.create(null); // in-memory mirror (keeps reads sync)
  var db      = null;

  /* Open (or create) the IndexedDB database */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror   = function (e) { reject(e.target.error); };
    });
  }

  /* Convenience: open a transaction and return the object store */
  function store(mode) {
    if (!db) return null;
    try { return db.transaction(STORE, mode).objectStore(STORE); }
    catch (e) { return null; }
  }

  /* Drop-in localStorage replacement */
  var shim = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    setItem: function (k, v) {
      mem[k] = String(v);
      var s = store('readwrite');
      if (s) s.put(String(v), k);
    },
    removeItem: function (k) {
      delete mem[k];
      var s = store('readwrite');
      if (s) s.delete(k);
    },
    clear: function () {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      var s = store('readwrite');
      if (s) s.clear();
    },
    key: function (n) {
      return Object.keys(mem)[n] !== undefined ? Object.keys(mem)[n] : null;
    },
    get length() { return Object.keys(mem).length; }
  };

  /* Replace window.localStorage */
  try {
    Object.defineProperty(window, 'localStorage', {
      value: shim, writable: false, configurable: false
    });
  } catch (e) {
    window.localStorage = shim; // fallback for older engines
  }

  /*
   * Hide the page until IndexedDB data is loaded into the mirror.
   * This prevents a flash of empty state (e.g. blank todo list, broken streak)
   * before the async load completes.
   */
  document.documentElement.style.visibility = 'hidden';

  openDB().then(function (database) {
    db = database;

    var txn   = db.transaction(STORE, 'readonly');
    var st    = txn.objectStore(STORE);
    var vReq  = st.getAll();      // all values
    var kReq  = st.getAllKeys();  // all keys (same order)
    var vals, keys;

    function tryReveal() {
      if (vals === undefined || keys === undefined) return;
      keys.forEach(function (k, i) { mem[k] = vals[i]; });
      document.documentElement.style.visibility = '';
    }

    vReq.onsuccess = function () { vals = vReq.result; tryReveal(); };
    kReq.onsuccess = function () { keys = kReq.result; tryReveal(); };

    /* On any error, reveal anyway so the app isn't stuck invisible */
    txn.onerror = function () {
      document.documentElement.style.visibility = '';
    };
  }).catch(function () {
    document.documentElement.style.visibility = '';
  });
}());
</script>`;
}
