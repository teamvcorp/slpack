"use client";

/**
 * Error boundary for the whole admin area.
 *
 * WHY THIS EXISTS (added 2026-09-09): the app had no error boundary at all, so
 * a single unexpected value anywhere in an admin render took down the ENTIRE
 * page — nav included — and React replaced it with the browser-level
 * "Application error: a client-side exception has occurred". Staff at the
 * counter got a blank screen with nothing to act on and no way back.
 *
 * The trigger was one shipment row whose carrier cost was stored as null;
 * null.toFixed() threw while drawing the Reports table (see
 * app/admin/log/page.tsx). That specific bug is fixed, but the lesson is the
 * blast radius, not the bug: the shipment log is six months of accumulated
 * records written by many different versions of this app, so another row will
 * eventually carry a shape today's code does not expect.
 *
 * Because Next renders this in place of {children} INSIDE app/admin/layout.tsx,
 * AdminNav survives — the operator can walk to another tab instead of being
 * stranded. `reset()` re-renders the failed segment, which is usually enough
 * once a transient fetch is retried.
 *
 * Security note: the message and digest are deliberately NOT shown. An error
 * string can carry connection details or record contents, and this screen is
 * visible to anyone at the counter. Diagnosis goes to the console (and to
 * Vercel's logs via the digest), not to the shop floor.
 */

import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Full detail for whoever opens devtools; never rendered into the page.
    console.error('[admin] render failed', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <div className="rounded-xl border border-red/20 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-extrabold text-navy">This screen hit a problem</h1>
        <p className="mt-2 text-sm text-navy/60">
          Nothing was lost — sales, shipments and drop-offs are all saved. Try again, or
          use the menu above to move to another screen.
        </p>
        {error.digest && (
          /* Opaque id only. Lets support match this screen to a server log line
             without exposing what actually went wrong to the sales floor. */
          <p className="mt-4 font-mono text-[11px] text-navy/30">Reference {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy/90"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy transition-colors hover:bg-cream"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
