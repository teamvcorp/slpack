import Link from 'next/link';

const TILES = [
  {
    href: '/admin/shipping',
    icon: '📦',
    title: 'Shipping Comparison',
    desc: 'Compare live rates from FedEx, UPS, USPS, and DHL side-by-side, then bill customers via Stripe.',
    badge: '4 carriers',
  },
  {
    href: '/admin/log',
    icon: '📋',
    title: 'Shipping Log',
    desc: 'View daily, weekly, and monthly shipping activity with revenue totals by carrier.',
    badge: null,
  },
];

export default function AdminDashboard() {
  return (
    <div className="py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-navy/50">Storm Lake Pack and Ship — Internal Tools</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="group flex flex-col rounded-xl border border-navy/10 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <span className="text-3xl">{tile.icon}</span>
              {tile.badge && (
                <span className="rounded-full bg-blue/10 px-2 py-0.5 text-xs font-semibold text-blue">
                  {tile.badge}
                </span>
              )}
            </div>
            <h2 className="mt-4 text-base font-semibold text-navy group-hover:text-blue">
              {tile.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-navy/60">{tile.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
