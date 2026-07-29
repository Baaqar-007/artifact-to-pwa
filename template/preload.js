'use strict';
/**
 * Electron preload script.
 *
 * Runs in the renderer context with Node access, before any page scripts.
 * Exposes a minimal IPC surface via contextBridge so the localStorage shim
 * (injected into index.html at build time) can send writes to the main process
 * for atomic file-system persistence.
 *
 * contextIsolation: true is intentional — only the three storage channels are
 * exposed, nothing else. The renderer cannot access Node or Electron APIs directly.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__electronAPI', {
  storageSet:    (key, value) => ipcRenderer.send('storage:set',    { key, value }),
  storageRemove: (key)        => ipcRenderer.send('storage:remove', { key }),
  storageClear:  ()           => ipcRenderer.send('storage:clear'),
});
