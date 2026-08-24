"use client";

import { useEffect, useState } from 'react';
import { isStaleClient, isQuoteStale, RATE_MAX_AGE_MS } from '@/lib/appVersion';

interface Props {
  /** buildId reported by the most recent rate response (null until first Compare). */
  serverBuildId: string | null;
  /** Epoch ms of the last Compare, or null if rates haven't been fetched. */
  quotedAt: number | null;
}

/**
 * Counter-facing warnings for a page that has drifted out of date.
 *
 * Two independent problems, both of which end in the customer being charged the
 * wrong amount, because the cart total is added up in the browser:
 *
 *  1. Old deployment — the tab was loaded before a deploy and is still running
 *     the prices it was built with. Only a reload fixes this.
 *  2. Old quote — carrier costs move (weekly fuel surcharges, January rate
 *     increases), so a quote held too long may no longer cover our cost.
 *
 * Deliberately loud: this sits above the rate panels, and the deploy warning is
 * red because staff must act on it before taking any more money.
 */
export default function StaleSessionBanner({ serverBuildId, quotedAt }: Props) {
  // Quote age is time-based, so nothing would re-render on its own. Tick while a
  // quote is held so the warning appears the moment it goes stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!quotedAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [quotedAt]);

  const outdatedBuild = isStaleClient(serverBuildId);
  const staleQuote = isQuoteStale(quotedAt, now);

  if (!outdatedBuild && !staleQuote) return null;

  const minutes = Math.round(RATE_MAX_AGE_MS / 60_000);

  return (
    <div className="space-y-2">
      {outdatedBuild && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3"
        >
          <span aria-hidden className="text-lg leading-none">⚠️</span>
          <div className="text-sm">
            <p className="font-semibold text-red-800">
              This page is running an older version of the app
            </p>
            <p className="mt-0.5 text-red-700">
              It may quote and charge outdated prices. Reload before ringing up another
              customer — <span className="font-semibold">Ctrl + Shift + R</span>.
            </p>
          </div>
        </div>
      )}

      {staleQuote && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <span aria-hidden className="text-lg leading-none">⏱️</span>
          <div className="text-sm">
            <p className="font-semibold text-amber-900">
              These rates are more than {minutes} minutes old
            </p>
            <p className="mt-0.5 text-amber-800">
              Carrier costs may have changed since they were quoted. Press Compare again
              before charging.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
