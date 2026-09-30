const api = window.dallmayrRFID;
const STORAGE_KEY = 'dallmayr-rfid-bridge-scans-v1';

const state = {
  connected: false,
  paused: false,
  port: '',
  firmware: '',
  scans: loadScans()
};

const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  portText: document.getElementById('portText'),
  firmwareBadge: document.getElementById('firmwareBadge'),
  totalScans: document.getElementById('totalScans'),
  uniqueCards: document.getElementById('uniqueCards'),
  latestDec: document.getElementById('latestDec'),
  latestReverse: document.getElementById('latestReverse'),
  scanRows: document.getElementById('scanRows'),
  firmwareMode: document.getElementById('firmwareMode'),
  saveCsv: document.getElementById('saveCsv'),
  clearScans: document.getElementById('clearScans'),
  readCard: document.getElementById('readCard'),
  writeCard: document.getElementById('writeCard'),
  cancelAction: document.getElementById('cancelAction'),
  writeText: document.getElementById('writeText'),
  storedText: document.getElementById('storedText'),
  storedHex: document.getElementById('storedHex'),
  message: document.getElementById('message'),
  quitApp: document.getElementById('quitApp')
};

function loadScans() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveScans() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.scans));
}

function setMessage(text) {
  els.message.textContent = text;
}

function setConnected(connected, port = '', paused = state.paused) {
  state.connected = Boolean(connected);
  state.paused = Boolean(paused);
  state.port = port || '';

  els.statusDot.classList.toggle('offline', !state.connected);
  els.statusDot.classList.toggle('online', state.connected);

  if (state.paused) {
    els.statusText.textContent = 'Firmware update mode';
    els.portText.textContent = 'COM ports released for Arduino IDE / flashing.';
    els.firmwareBadge.textContent = 'Paused';
    els.firmwareMode.textContent = 'Resume reader';
  } else {
    els.statusText.textContent = state.connected ? 'RFID reader connected' : 'Waiting for RFID reader…';
    els.portText.textContent = state.connected ? `${state.port} · 115200 baud` : 'Connect the ESP32 reader by USB.';
    els.firmwareBadge.textContent = state.connected ? (state.firmware || 'Connected') : 'Offline';
    els.firmwareMode.textContent = 'Firmware update mode';
  }

  [els.readCard, els.writeCard, els.cancelAction].forEach((button) => {
    button.disabled = !state.connected || state.paused;
  });
}

function addScan(event) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    scannedAt: new Date().toISOString(),
    uid: String(event.uid || ''),
    idDec: String(event.idDec || ''),
    reverseDec: String(event.idReverseDec || '').padStart(10, '0'),
    cardType: String(event.cardType || '')
  };
  state.scans.push(record);
  saveScans();
  renderScans();
  setMessage(`Scanned ${record.reverseDec}`);
}

function renderScans() {
  const scans = state.scans;
  els.totalScans.textContent = String(scans.length);
  els.uniqueCards.textContent = String(new Set(scans.map((scan) => scan.reverseDec)).size);
  const latest = scans[scans.length - 1];
  els.latestDec.textContent = latest?.idDec || '—';
  els.latestReverse.textContent = latest?.reverseDec || '—';
  els.saveCsv.disabled = scans.length === 0;
  els.clearScans.disabled = scans.length === 0;

  if (!scans.length) {
    els.scanRows.innerHTML = '<tr><td colspan="7" class="empty">Present a card to begin.</td></tr>';
    return;
  }

  els.scanRows.innerHTML = [...scans].reverse().map((scan, reverseIndex) => {
    const number = scans.length - reverseIndex;
    return `<tr>
      <td>${number}</td>
      <td>${escapeHtml(new Date(scan.scannedAt).toLocaleString())}</td>
      <td class="mono">${escapeHtml(scan.uid)}</td>
      <td class="mono">${escapeHtml(scan.idDec)}</td>
      <td class="mono emphasis">${escapeHtml(scan.reverseDec)}</td>
      <td>${escapeHtml(scan.cardType)}</td>
      <td><button class="copy" data-copy="${escapeAttr(scan.reverseDec)}">Copy</button></td>
    </tr>`;
  }).join('');

  els.scanRows.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(value);
        setMessage(`Copied ${value}`);
      } catch {
        setMessage('Could not copy to the clipboard.');
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function buildCsv() {
  const rows = [
    ['Number', 'Scanned', 'UID', 'ID (dec)', 'ID (reverse dec)', 'Card type'],
    ...state.scans.map((scan, index) => [
      String(index + 1),
      scan.scannedAt,
      scan.uid,
      scan.idDec,
      scan.reverseDec,
      scan.cardType
    ])
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

async function send(command, successMessage) {
  try {
    await api.sendCommand(command);
    if (successMessage) setMessage(successMessage);
  } catch (error) {
    setMessage(error?.message || 'Could not communicate with the RFID reader.');
  }
}

api.onStatus((status) => {
  setConnected(Boolean(status.connected), status.path || '', Boolean(status.paused));
  if (status.paused) {
    setMessage('Firmware update mode active. You can upload to ESP32 devices now.');
  } else if (!status.connected) {
    state.firmware = '';
    setMessage('Waiting for reader. Plug the ESP32 into USB.');
  }
});

api.onEvent((event) => {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'ready') {
    state.firmware = event.version ? `v${event.version}` : 'Connected';
    els.firmwareBadge.textContent = state.firmware;
    setMessage(`${event.device || 'Dallmayr RFID Reader'} ${state.firmware} is ready.`);
    return;
  }

  if (event.type === 'scan') {
    addScan(event);
    return;
  }

  if (event.type === 'read_result') {
    if (event.success === false) {
      setMessage(event.message || 'Card read failed.');
    } else {
      els.storedText.textContent = String(event.data || '') || '—';
      els.storedHex.textContent = String(event.blockHex || '') || '—';
      setMessage(event.message || 'Card memory read successfully.');
    }
    return;
  }

  if (event.type === 'write_result') {
    if (event.success === false) {
      setMessage(event.message || 'Card write failed.');
    } else {
      els.storedText.textContent = String(event.data || '') || '—';
      els.storedHex.textContent = String(event.blockHex || '') || '—';
      setMessage(event.message || 'Card write completed and verified.');
    }
    return;
  }

  if (event.message) setMessage(String(event.message));
});

els.firmwareMode.addEventListener('click', async () => {
  try {
    const nextPaused = !state.paused;
    const status = await api.setPaused(nextPaused);
    setConnected(Boolean(status.connected), status.path || '', Boolean(status.paused));
    setMessage(nextPaused
      ? 'Firmware update mode active. COM ports released; upload as many devices as needed.'
      : 'Reader mode resumed.');
  } catch (error) {
    setMessage(error?.message || 'Could not change firmware update mode.');
  }
});

els.readCard.addEventListener('click', () => send('READ', 'Read requested. Present the card.'));
els.cancelAction.addEventListener('click', () => send('CANCEL', 'Pending card action cancelled.'));
els.writeCard.addEventListener('click', () => {
  const text = els.writeText.value.trim();
  if (!text) return setMessage('Enter data before writing the card.');
  if (text.length > 16) return setMessage('Card data is limited to 16 characters.');
  if (!/^[\x20-\x7E]+$/.test(text) || text.includes('|')) {
    return setMessage('Use printable characters only and do not include |.');
  }
  send(`WRITE|${text}`, 'Write requested. Present the card.');
});

els.saveCsv.addEventListener('click', async () => {
  try {
    const result = await api.saveCsv(buildCsv());
    if (result?.saved) setMessage(`Saved ${result.filePath}`);
  } catch (error) {
    setMessage(error?.message || 'Could not save CSV.');
  }
});

els.clearScans.addEventListener('click', () => {
  if (!confirm('Clear all saved RFID scans from this computer?')) return;
  state.scans = [];
  saveScans();
  renderScans();
  setMessage('Scan list cleared.');
});

els.quitApp.addEventListener('click', () => api.quit());

(async () => {
  const status = await api.getStatus();
  setConnected(Boolean(status.connected), status.path || '', Boolean(status.paused));
  renderScans();
})();
