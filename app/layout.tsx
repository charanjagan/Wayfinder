import type { Metadata, Viewport } from 'next';
import RegisterServiceWorker from '@/components/RegisterServiceWorker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wayfinder',
  description: 'Local office wayfinding tool',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Wayfinder',
  },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  viewportFit: 'cover',
  // Kiosk display: no pinch-zoom on the shell itself (the floor plan has its own zoom).
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
