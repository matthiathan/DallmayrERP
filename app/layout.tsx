import type { ReactNode } from 'react';
import './globals.css';
import './hamster-loader.css';
import { AuthProvider } from '@/components/auth/AuthProvider';

export const metadata = {
  title: 'DallmayrERP',
  description: 'Dallmayr South Africa internal operations ERP',
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
