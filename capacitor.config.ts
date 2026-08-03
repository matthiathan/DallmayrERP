import type { CapacitorConfig } from '@capacitor/cli';

const hostedAppUrl =
  process.env.CAPACITOR_SERVER_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'https://dallmayrerp.onrender.com';

const config: CapacitorConfig = {
  appId: 'za.co.dallmayr.erp',
  appName: 'DallmayrERP',
  webDir: 'native/mobile/www',
  server: {
    url: hostedAppUrl,
    cleartext: hostedAppUrl.startsWith('http://'),
  },
};

export default config;
