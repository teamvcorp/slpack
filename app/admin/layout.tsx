import type { Metadata } from 'next';
import AdminNav from './components/AdminNav';

export const metadata: Metadata = {
  title: 'Admin | Storm Lake Pack & Ship',
  description: 'Internal admin tools for Storm Lake Pack and Ship',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream">
      <AdminNav />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
