import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wayfinder',
  description: 'Local office wayfinding tool',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
