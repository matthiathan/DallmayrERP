import type { NextConfig } from 'next';

const isDevelopment = process.env.NODE_ENV !== 'production';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const internalMessagingEnabled = process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED === 'true' ? 'true' : 'false';
const supabaseOrigin = (() => {
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return 'https://egbiiizxsqlarqpnzxxs.supabase.co';
  }
})();

const connectSources = [
  "'self'",
  supabaseOrigin,
  supabaseOrigin.replace('https://', 'wss://'),
  ...(isDevelopment ? ['ws://localhost:*', 'http://localhost:*'] : []),
];

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      `connect-src ${connectSources.join(' ')}`,
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${supabaseOrigin}`,
      "font-src 'self' data:",
      `media-src 'self' data: blob: ${supabaseOrigin}`,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join('; '),
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=()',
      'bluetooth=()',
      'camera=(self)',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'picture-in-picture=()',
      'publickey-credentials-get=()',
      'serial=()',
      'sync-xhr=()',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED: internalMessagingEnabled,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
