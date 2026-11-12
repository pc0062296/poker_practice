/*
 * Desktop wrapper: shows the built web app (dist/) in its own window.
 *
 * Files are served from a private "app://" scheme instead of file:// so that ES modules,
 * the grading web worker, localStorage and IndexedDB all behave as on a normal web page,
 * and saved data stays in this app's own profile folder.
 */
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const HOST = 'poker';
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function serveFile(request) {
  const { pathname } = new URL(request.url);
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const file = path.normalize(path.join(DIST, relative));
  if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0b1016',
    icon: path.join(DIST, 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Links that leave the app open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL(`${SCHEME}://${HOST}/index.html`);
  return win;
}

// One window only: a second launch focuses the running app (both would share the same data).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    protocol.handle(SCHEME, serveFile);
    Menu.setApplicationMenu(null);
    mainWindow = createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
