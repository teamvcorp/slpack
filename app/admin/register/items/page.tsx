import Link from 'next/link';
import RegisterItemsEditor from '../../components/RegisterItemsEditor';

/**
 * Register item management. Its own page rather than a card on /admin/settings —
 * a CRUD table plus grouping is far larger than the settings cards and would
 * bury them. Reached from the Register header, because that is where staff are
 * standing when they notice a wrong price.
 */
export default function RegisterItemsPage() {
  return (
    <div className="py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Register items</h1>
          <p className="mt-1 text-sm text-navy/50">
            Add, edit and arrange what the register sells — no Stripe Dashboard needed.
          </p>
        </div>
        <Link
          href="/admin/register"
          className="shrink-0 rounded-lg border border-navy/20 px-3 py-2 text-sm font-medium text-navy/70 transition-colors hover:border-blue/40 hover:text-blue"
        >
          ← Back to register
        </Link>
      </div>
      <RegisterItemsEditor />
    </div>
  );
}
