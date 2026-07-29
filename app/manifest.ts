import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'DallmayrERP',
    short_name: 'DallmayrERP',
    description: 'Dallmayr South Africa internal operations ERP',
    start_url: '/workspace',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0f1419',
    theme_color: '#0f1419',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icons/dallmayr-app.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/dallmayr-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Start Page',
        short_name: 'Home',
        url: '/workspace',
        icons: [{ src: '/icons/dallmayr-app.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      {
        name: 'Action Centre',
        short_name: 'Tasks',
        url: '/work',
        icons: [{ src: '/icons/dallmayr-app.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    ],
  };
}
