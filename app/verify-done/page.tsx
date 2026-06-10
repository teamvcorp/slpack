import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ID Verification Complete',
  robots: { index: false, follow: false },
};

// Public landing page the shipper sees on their phone after finishing Stripe Identity.
export default function VerifyDonePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-bold text-navy">Thank you!</h1>
        <p className="mt-2 text-sm text-navy/60">
          Your ID has been submitted for verification. You can close this page and return to the
          counter — the clerk will see your status update shortly.
        </p>
        <p className="mt-4 text-xs text-navy/40">Storm Lake Pack &amp; Ship</p>
      </div>
    </main>
  );
}
