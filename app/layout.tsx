import './globals.css';

export const metadata = {
  title: 'DallmayrERP',
  description: 'Dallmayr South Africa internal operations ERP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
