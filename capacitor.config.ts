import type { CapacitorConfig } from '@capacitor/cli';

const liveReloadUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'za.co.dallmayr.erp',
  appName: 'DallmayrERP',
  webDir: 'native/mobile/www',
  ...(liveReloadUrl
    ? {
        server: {
          url: liveReloadUrl,
          cleartext: liveReloadUrl.startsWith('http://'),
        },
      }
    : {}),
};

export default config;
