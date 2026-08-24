/**
 * Deployment identity — used to spot a browser tab left open across a deploy.
 *
 * Why this matters at the counter: a tab loaded before a deploy keeps running the
 * JavaScript it was served. Because prices are added up in the browser, that tab
 * charges the OLD prices indefinitely, and the customer is charged whatever it
 * asks for. That is a silent revenue leak — the shipping markup changed and the
 * stale register kept billing yesterday's numbers.
 *
 * CLIENT_BUILD_ID is inlined into the bundle at build time; serverBuildId() is
 * read at request time. When a rate response reports a different id than the one
 * baked into the page, the page is out of date and staff are told to reload.
 *
 * Degrades to silence: if either id is missing (local dev, or Vercel's system
 * environment variables not exposed to the build) the check is skipped entirely
 * rather than nagging with a banner that can never be cleared.
 */

/** Build id compiled into the browser bundle. Null when unavailable. */
export const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null;

/** Build id of the deployment currently serving requests. Null when unavailable. */
export function serverBuildId(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? null;
}

/** True only when both ids are known AND differ — i.e. this tab is provably old. */
export function isStaleClient(serverId: unknown): boolean {
  const server = typeof serverId === 'string' && serverId.length > 0 ? serverId : null;
  if (!server || !CLIENT_BUILD_ID) return false;
  return server !== CLIENT_BUILD_ID;
}

/**
 * How long a carrier quote may sit before staff must re-compare.
 *
 * Carrier costs move underneath a held quote: fuel surcharges reset weekly and
 * general rate increases land each January. Thirty minutes is comfortably longer
 * than a normal counter transaction while ruling out a quote held over lunch —
 * or overnight — being charged at yesterday's cost.
 */
export const RATE_MAX_AGE_MS = 30 * 60 * 1000;

/** True when a quote taken at `quotedAt` (epoch ms) is too old to charge from. */
export function isQuoteStale(quotedAt: number | null, now: number): boolean {
  if (!quotedAt) return false;
  return now - quotedAt > RATE_MAX_AGE_MS;
}
