'use client';

import { ChangeEvent, useState } from 'react';

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect: (source: HTMLImageElement | ImageBitmap | Blob) => Promise<Array<{ rawValue: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor & { getSupportedFormats?: () => Promise<string[]> };
  }
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
  const [message, setMessage] = useState('Camera scan uses BarcodeDetector when available. Manual entry is always available.');

  async function readBarcodeFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const Detector = window.BarcodeDetector;
    if (!Detector) {
      setMessage('This browser does not support native barcode detection. Type or paste the barcode manually.');
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = imageUrl;
    image.onload = async () => {
      try {
        const detector = new Detector({
          formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e'],
        });
        const results = await detector.detect(image);
        const rawValue = results[0]?.rawValue;
        if (rawValue) {
          onChange(rawValue);
          setMessage(`Scanned barcode: ${rawValue}`);
        } else {
          setMessage('No barcode found in the photo. Try again or enter manually.');
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Barcode scan failed. Enter manually.');
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }

  return (
    <div className="scanner-box">
      <label>
        {label}
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Scan or type barcode" />
      </label>
      <label>
        Scan barcode photo
        <input accept="image/*" capture="environment" type="file" onChange={readBarcodeFromFile} />
      </label>
      <p>{message}</p>
    </div>
  );
}
