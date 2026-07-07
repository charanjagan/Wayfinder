import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Office Wayfinder',
    short_name: 'Wayfinder',
    description: 'Local office wayfinding kiosk',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Lobby-mounted directory kiosks are conventionally landscape tablets/displays.
    orientation: 'landscape',
    background_color: '#f1f5f9',
    theme_color: '#4f46e5',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
