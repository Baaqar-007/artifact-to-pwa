'use strict';
/**
 * Electron main process.
 *
 * Responsibilities:
 *   1. Read storage.json from the OS user-data directory on startup.
 *   2. Inject window.__initialStorage into index.html via a temp file so
 *      the localStorage shim can pre-populate its in-memory mirror before
 *      any React code runs (avoids a blank flash of empty state).
 *   3. Listen for IPC writes from the renderer and atomically persist them
 *      back to storage.json.
 *
 * Storage file location (per OS):
 *   Windows : %APPDATA%\<AppName>\storage.json
 *   macOS   : ~/Library/Application Support/<AppName>/storage.json
 *   Linux   : ~/.config/<AppName>/storage.json
 */

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path  = require('path');
const fs    = require('fs');

const STORAGE_FILE = path.join(app.getPath('userData'), 'storage.json');

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadStorage() {
  try {
    return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
  } catch {
    return {};  // First launch or corrupted file — start fresh
  }
}

function saveStorage(data) {
  try {
    const tmp = STORAGE_FILE + '.tmp';
    fs.mkdirSync(path.dirname(STORAGE_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, STORAGE_FILE);
  } catch (err) {
    console.error('[storage] write failed:', err.message);
  }
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  const htmlSrc  = path.join(__dirname, 'web', 'index.html');
  let   html     = fs.readFileSync(htmlSrc, 'utf8');

  const storedData  = loadStorage();
  const safeJSON    = JSON.stringify(storedData).replace(/</g, '\\u003c');
  const initScript  = `<script>window.__initialStorage=${safeJSON};</script>\n`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, `$1\n${initScript}`);
  } else {
    html = `<head>\n${initScript}</head>\n` + html;
  }

  const tmpPath = path.join(app.getPath('temp'), `artifact-${Date.now()}.html`);
  fs.writeFileSync(tmpPath, html, 'utf8');

  const win = new BrowserWindow({
    width:  1280,
    height: 800,
    show:   false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:"
        ],
      },
    });
  });

  win.loadFile(tmpPath);

  win.once('ready-to-show', () => {
    win.show();
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 10_000);
  });

  win.on('closed', () => { try { fs.unlinkSync(tmpPath); } catch {} });

  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  ipcMain.on('storage:set', (_, { key, value }) => {
    const data = loadStorage(); data[key] = value; saveStorage(data);
  });
  ipcMain.on('storage:remove', (_, { key }) => {
    const data = loadStorage(); delete data[key]; saveStorage(data);
  });
  ipcMain.on('storage:clear', () => { saveStorage({}); });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
