const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');

if (require('electron-squirrel-startup')) {
  app.quit();
}

const BAUD_RATE = 115200;
const POLL_MS = 1800;
const HANDSHAKE_TIMEOUT_MS = 1800;
const TARGET_DEVICE = 'Dallmayr RFID Reader';
const CP210X_VENDOR_ID = '10C4';
const CP2102_PRODUCT_ID = 'EA60';

let mainWindow = null;
let activePort = null;
let activePortInfo = null;
let scanTimer = null;
let quitting = false;
let probing = false;
let paused = false;
let lineBuffer = '';

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function currentStatus() {
  return {
    connected: Boolean(activePort && activePort.isOpen),
    paused,
    path: activePortInfo?.path || '',
    manufacturer: activePortInfo?.manufacturer || '',
    serialNumber: activePortInfo?.serialNumber || '',
    vendorId: activePortInfo?.vendorId || '',
    productId: activePortInfo?.productId || ''
  };
}

function createWindow(showImmediately = false) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Dallmayr RFID Reader',
    backgroundColor: '#f3f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (showImmediately) mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function looksLikeCp210x(portInfo) {
  const vid = String(portInfo.vendorId || '').toUpperCase();
  const pid = String(portInfo.productId || '').toUpperCase();
  const text = `${portInfo.manufacturer || ''} ${portInfo.pnpId || ''}`.toLowerCase();
  return (vid === CP210X_VENDOR_ID && pid === CP2102_PRODUCT_ID) ||
    text.includes('cp210') || text.includes('silicon labs');
}

function writeLine(port, text) {
  return new Promise((resolve, reject) => {
    if (!port || !port.isOpen) return reject(new Error('Reader is not connected.'));
    port.write(`${text}\n`, (error) => {
      if (error) return reject(error);
      port.drain((drainError) => drainError ? reject(drainError) : resolve());
    });
  });
}

function closePort(port) {
  return new Promise((resolve) => {
    if (!port || !port.isOpen) return resolve();
    port.close(() => resolve());
  });
}

async function releaseActivePort() {
  const port = activePort;
  activePort = null;
  activePortInfo = null;
  lineBuffer = '';
  if (port) {
    try { port.removeAllListeners('data'); } catch {}
    try { port.removeAllListeners('close'); } catch {}
    try { port.removeAllListeners('error'); } catch {}
    await closePort(port);
  }
  sendToRenderer('rfid:status', currentStatus());
}

async function probeCandidate(info) {
  if (paused) return null;
  const port = new SerialPort({ path: info.path, baudRate: BAUD_RATE, autoOpen: false });
  let buffer = '';

  return new Promise((resolve) => {
    let finished = false;
    const finish = async (ok, readyEvent = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      port.removeAllListeners('data');
      port.removeAllListeners('error');
      if (!ok || paused) await closePort(port);
      resolve(ok && !paused ? { port, readyEvent } : null);
    };

    const timeout = setTimeout(() => finish(false), HANDSHAKE_TIMEOUT_MS);

    port.on('error', () => finish(false));
    port.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('{')) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'ready' && event.device === TARGET_DEVICE) {
            finish(true, event);
            return;
          }
        } catch {}
      }
    });

    port.open(async (error) => {
      if (error) return finish(false);
      try {
        await writeLine(port, 'PING');
      } catch {
        finish(false);
      }
    });
  });
}

function bindActivePort(port, info, readyEvent) {
  if (paused) {
    void closePort(port);
    return;
  }

  activePort = port;
  activePortInfo = info;
  lineBuffer = '';

  port.on('data', (chunk) => {
    lineBuffer += chunk.toString('utf8');
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('{')) continue;
      try {
        const event = JSON.parse(line);
        sendToRenderer('rfid:event', event);
      } catch {}
    }
  });

  const disconnected = () => {
    if (activePort !== port) return;
    activePort = null;
    activePortInfo = null;
    sendToRenderer('rfid:status', currentStatus());
  };

  port.on('close', disconnected);
  port.on('error', (error) => {
    sendToRenderer('rfid:event', { type: 'error', message: `Serial connection error: ${error.message}` });
  });

  sendToRenderer('rfid:status', currentStatus());
  if (readyEvent) sendToRenderer('rfid:event', readyEvent);
  showWindow();
}

async function discoverReader() {
  if (paused || probing || activePort?.isOpen) return;
  probing = true;
  try {
    const ports = await SerialPort.list();
    const candidates = ports.filter(looksLikeCp210x);

    for (const info of candidates) {
      if (paused) break;
      const result = await probeCandidate(info);
      if (result) {
        bindActivePort(result.port, info, result.readyEvent);
        return;
      }
    }
  } catch (error) {
    sendToRenderer('rfid:event', { type: 'error', message: `Reader discovery failed: ${error.message}` });
  } finally {
    probing = false;
  }
}

function startDiscovery() {
  if (scanTimer) return;
  void discoverReader();
  scanTimer = setInterval(() => void discoverReader(), POLL_MS);
}

ipcMain.handle('rfid:get-status', () => currentStatus());
ipcMain.handle('rfid:show-window', () => showWindow());
ipcMain.handle('rfid:set-paused', async (_event, shouldPause) => {
  paused = Boolean(shouldPause);
  if (paused) {
    await releaseActivePort();
    sendToRenderer('rfid:event', { type: 'status', message: 'Firmware update mode enabled. COM ports are released.' });
  } else {
    sendToRenderer('rfid:status', currentStatus());
    sendToRenderer('rfid:event', { type: 'status', message: 'Reader discovery resumed.' });
    setTimeout(() => void discoverReader(), 250);
  }
  return currentStatus();
});
ipcMain.handle('rfid:command', async (_event, command) => {
  if (paused) throw new Error('Firmware update mode is enabled.');
  if (!activePort?.isOpen) throw new Error('RFID reader is not connected.');
  await writeLine(activePort, String(command));
  return true;
});
ipcMain.handle('rfid:save-csv', async (_event, csvText) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save RFID scans',
    defaultPath: `RFID-Scans-${stamp}.csv`,
    filters: [{ name: 'CSV files', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, `\uFEFF${String(csvText)}`, 'utf8');
  return { saved: true, filePath: result.filePath };
});
ipcMain.handle('rfid:quit', () => {
  quitting = true;
  app.quit();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    const launchedHidden = process.argv.includes('--hidden');
    createWindow(!launchedHidden);

    app.setLoginItemSettings({
      openAtLogin: true,
      args: ['--hidden']
    });

    startDiscovery();
  });
}

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  quitting = true;
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  if (activePort?.isOpen) {
    try { activePort.close(); } catch {}
  }
});
