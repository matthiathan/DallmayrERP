'use client';

import { ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import type { Html5Qrcode as Html5QrcodeInstance } from 'html5-qrcode';

type ScannerMessageType = 'info' | 'success' | 'warning' | 'error';

function cleanScanValue(value: string) {
  return value.trim().replace(/^\uFEFF/, '');
}

function messageClass(type: ScannerMessageType) {
  if (type === 'success') return 'success';
  if (type === 'error') return 'error';
  if (type === 'warning') return 'badge warning';
  return 'nav-heading';
}

export function BarcodeCapture({
  label = 'Barcode',
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [message, setMessage] = useState('Tap Start camera to scan, or type the code manually. QR links are treated as plain text only.');
  const [messageType, setMessageType] = useState<ScannerMessageType>('info');
  const [cameraActive, setCameraActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [fileScanning, setFileScanning] = useState(false);
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const scanLockedRef = useRef(false);
  const scannerId = `live-scanner-${useId().replace(/:/g, '-')}`;

  async function loadScannerModule() {
    return import('html5-qrcode');
  }

  function acceptScan(rawValue: string) {
    const cleanValue = cleanScanValue(rawValue);
    if (!cleanValue) return;
    onChange(cleanValue);
    setMessage(`Scanned: ${cleanValue}`);
    setMessageType('success');
  }

  async function stopCamera() {
    const scanner = scannerRef.current;
    if (!scanner) {
      setCameraActive(false);
      scanLockedRef.current = false;
      return;
    }

    try {
      await scanner.stop();
    } catch {
      // Some browsers throw if stop is called after the stream has already stopped.
    }

    try {
      await scanner.clear();
    } catch {
      // Clear can throw if the internal element has already been reset.
    } finally {
      scannerRef.current = null;
      scanLockedRef.current = false;
      setCameraActive(false);
      setStarting(false);
    }
  }

  async function startCamera() {
    if (starting || cameraActive) return;
    setStarting(true);
    setMessage('Opening rear camera. Allow camera access when prompted.');
    setMessageType('info');

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadScannerModule();
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.PDF_417,
      ];
      const scanner = new Html5Qrcode(scannerId, { formatsToSupport, verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
            width: Math.min(Math.floor(viewfinderWidth * 0.9), 520),
            height: Math.min(Math.floor(viewfinderHeight * 0.45), 240),
          }),
          aspectRatio: 1.777778,
          disableFlip: true,
        },
        async (decodedText: string) => {
          if (scanLockedRef.current) return;
          scanLockedRef.current = true;
          acceptScan(decodedText);
          await stopCamera();
        },
        () => undefined,
      );

      setCameraActive(true);
      setStarting(false);
      setMessage('Camera active. Point the box at the machine QR code or stock barcode.');
      setMessageType('info');
    } catch (err) {
      scannerRef.current = null;
      scanLockedRef.current = false;
      setCameraActive(false);
      setStarting(false);
      setMessage(err instanceof Error ? err.message : 'Camera scanner could not start. Use manual entry or photo scan.');
      setMessageType('error');
    }
  }

  async function scanFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileScanning(true);
    setMessage('Scanning selected image locally on this device.');
    setMessageType('info');

    try {
      await stopCamera();
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadScannerModule();
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.PDF_417,
      ];
      const scanner = new Html5Qrcode(scannerId, { formatsToSupport, verbose: false });
      scannerRef.current = scanner;
      const decodedText = await scanner.scanFile(file, false);
      acceptScan(decodedText);
      await scanner.clear();
      scannerRef.current = null;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No barcode found in the photo. Try live camera or manual entry.');
      setMessageType('warning');
    } finally {
      setFileScanning(false);
      event.target.value = '';
    }
  }

  useEffect(() => () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    scanner.stop().catch(() => undefined).finally(() => Promise.resolve(scanner.clear()).catch(() => undefined));
  }, []);

  return (
    <div className="scanner-box live-scanner-box">
      <div className="scanner-header">
        <div>
          <div className="nav-heading">{label}</div>
          <p>Live camera scanner for QR codes and stock barcodes.</p>
        </div>
        <span className={cameraActive ? 'badge success' : 'badge'}>{cameraActive ? 'Camera on' : 'Ready'}</span>
      </div>

      <div id={scannerId} className={`live-scanner-view ${cameraActive ? 'is-active' : ''}`} />

      <div className="scanner-actions">
        <button className="button pulse-button" disabled={starting || cameraActive || fileScanning} onClick={startCamera} type="button">
          {starting ? 'Opening camera...' : 'Start camera scan'}
        </button>
        <button className="button secondary" disabled={!cameraActive && !starting} onClick={stopCamera} type="button">
          Stop camera
        </button>
      </div>

      <label>
        Manual code entry
        <input
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          inputMode="text"
          onChange={(event) => onChange(cleanScanValue(event.target.value))}
          placeholder="Scan or type code"
          spellCheck={false}
          value={value}
        />
      </label>

      <label>
        Scan from photo
        <input accept="image/*" capture="environment" disabled={fileScanning} type="file" onChange={scanFile} />
      </label>

      <p className={messageClass(messageType)}>{message}</p>
    </div>
  );
}
