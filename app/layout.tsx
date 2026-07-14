import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import './globals.css';
import './hamster-loader.css';
import './feature-widgets.css';
import './mobile.css';
import { AuthProvider } from '@/components/auth/AuthProvider';

export const metadata = {
  title: 'DallmayrERP',
  description: 'Dallmayr South Africa internal operations ERP',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
