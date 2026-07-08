import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wayfinder',
  description: 'Office wayfinder',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
