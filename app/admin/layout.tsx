import type { Metadata } from 'next';
import Script from 'next/script';
import AdminNav from './components/AdminNav';

export const metadata: Metadata = {
  title: 'Admin | Storm Lake Pack & Ship',
  description: 'Internal admin tools for Storm Lake Pack and Ship',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream">
      {/* Epson ePOS SDK for JavaScript — drives the receipt printer client-side.
          Loaded only within the admin area; exposes the global `window.epson`. */}
      <Script
        src="/ePOS_SDK_JavaScript_v2.27.0i/epos-2.27.0.js"
        strategy="afterInteractive"
      />
      <AdminNav />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
