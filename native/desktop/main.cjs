const path = require('node:path');
const { app, BrowserWindow, shell, session } = require('electron');

const DEFAULT_APP_URL = 'https://dallmayrerp.onrender.com';
const rawAppUrl = process.env.DALLMAYRERP_APP_URL || process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
const appUrl = new URL(rawAppUrl);
const allowedNavigationOrigins = new Set([
  appUrl.origin,
  'https://egbiiizxsqlarqpnzxxs.supabase.co',
]);
const allowedPermissions = new Set([
  'media',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
]);

function isAllowedNavigation(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return url.protocol === 'file:' || allowedNavigationOrigins.has(url.origin);
  } catch {
    return false;
  }
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    title: 'DallmayrERP',
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedNavigation(targetUrl)) return;
    event.preventDefault();
    shell.openExternal(targetUrl);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    mainWindow.loadFile(path.join(__dirname, 'offline.html'));
  });

  mainWindow.loadURL(appUrl.toString());
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ownerOrigin = new URL(webContents.getURL() || appUrl.toString()).origin;
    callback(ownerOrigin === appUrl.origin && allowedPermissions.has(permission));
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
