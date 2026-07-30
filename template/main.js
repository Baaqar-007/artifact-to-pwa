'use strict';
/**
 * Electron main process — v2.1.0
 * Fix #3: IPC handlers registered before window creation
 */

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs   = require('fs');

const STORAGE_FILE = path.join(app.getPath('userData'), 'storage.json');

function loadStorage() {
  try {
    return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[storage] Failed to load:', err.message);
    return {};
  }
}

function saveStorage(data) {
  try {
    const dir = path.dirname(STORAGE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = STORAGE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, STORAGE_FILE);
  } catch (err) {
    console.error('[storage] Write failed:', err.message);
  }
}

function createWindow() {
  const htmlSrc = path.join(__dirname, 'web', 'index.html');
  let   html    = fs.readFileSync(htmlSrc, 'utf8');
  const stored  = loadStorage();
  const safe    = JSON.stringify(stored).replace(/</g, '\\u003c');
  const init    = `<script>window.__initialStorage=${safe};</script>\n`;
  html = /<head[^>]*>/i.test(html)
    ? html.replace(/(<head[^>]*>)/i, `$1\n${init}`)
    : `<head>\n${init}</head>\n` + html;

  const tmpFile = path.join(app.getPath('userData'), `_launch-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf8');

  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:"] } });
  });

  win.loadFile(tmpFile);
  win.once('ready-to-show', () => { win.show(); setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 15_000); });
  win.on('closed', () => { try { fs.unlinkSync(tmpFile); } catch {} });
  return win;
}

app.whenReady().then(() => {
  // CHANGED: handlers registered BEFORE createWindow()
  ipcMain.on('storage:set',    (_, { key, value }) => { const d = loadStorage(); d[key] = value; saveStorage(d); });
  ipcMain.on('storage:remove', (_, { key })        => { const d = loadStorage(); delete d[key];  saveStorage(d); });
  ipcMain.on('storage:clear',  ()                  => { saveStorage({}); });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
