'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

type ScannerMessageType = 'info' | 'success' | 'warning' | 'error';

type Html5QrcodeInstance = {
  start: (
    cameraConfig: { facingMode?: string } | string,
    configuration: Record<string, unknown>,
    qrCodeSuccessCallback: (decodedText: string) => void,
    qrCodeErrorCallback?: () => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => Promise<void>;
  scanFile: (file: File, showImage?: boolean) => Promise<string>;
};

type Html5QrcodeConstructor = new (elementId: string, verbose?: boolean) => Html5QrcodeInstance;

type Html5QrcodeFormats = Record<string, number>;

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
  const scannerId = useMemo(() => `live-scanner-${Math.random().toString(36).slice(2, 10)}`, []);

  async function loadScannerModule() {
    const module = await import('html5-qrcode');
    return {
      Html5Qrcode: module.Html5Qrcode as Html5QrcodeConstructor,
      Html5QrcodeSupportedFormats: module.Html5QrcodeSupportedFormats as unknown as Html5QrcodeFormats,
    };
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
      if (cameraActive) await scanner.stop();
      await scanner.clear();
    } catch {
      // Some browsers throw if stop is called after the stream has already stopped.
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
      const scanner = new Html5Qrcode(scannerId, false);
      scannerRef.current = scanner;

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
      ].filter((format) => typeof format === 'number');

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
          formatsToSupport,
        },
        async (decodedText: string) => {
          if (scanLockedRef.current) return;
          scanLockedRef.current = true;
          acceptScan(decodedText);
          await stopCamera();
        },
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
      const { Html5Qrcode } = await loadScannerModule();
      const scanner = new Html5Qrcode(scannerId, false);
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
    scanner.stop().catch(() => undefined).finally(() => scanner.clear().catch(() => undefined));
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
        <input value={value} onChange={(event) => onChange(cleanScanValue(event.target.value))} placeholder="Scan or type code" inputMode="text" autoCapitalize="characters" />
      </label>

      <label>
        Scan from photo
        <input accept="image/*" capture="environment" disabled={fileScanning} type="file" onChange={scanFile} />
      </label>

      <p className={messageClass(messageType)}>{message}</p>
    </div>
  );
}
