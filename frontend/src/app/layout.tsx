import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import { ToastProvider } from '@/components/ui';
import { CursedBackground } from '@/components/CursedBackground';
import { SparkBurst } from '@/components/SparkBurst';
import { ThemeInit } from '@/components/ThemeInit';

export const metadata: Metadata = { title: 'Cafin Pay: wallet & payments', description: 'Fast, secure wallet payments.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#07070a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="text-zinc-100">
        <CursedBackground />
        <SparkBurst />
        <ThemeInit />
        <ToastProvider>{children}</ToastProvider>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
