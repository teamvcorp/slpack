import { NextRequest, NextResponse } from 'next/server';
import { clientIp, peek, hit } from '@/lib/rateLimit';
import {
  partnerApiEnabled,
  getPartnerByKeyId,
  verifyPartnerSecret,
  dummyVerify,
  touchPartnerUsed,
  type PartnerRecord,
} from '@/lib/partners';
import { logPartnerEvent } from '@/lib/partnerApiLog';

/**
 * Authentication wrapper for every Partner API route (2026-09-10).
 *
 * Server-to-server, so the credential is a STATIC issued key, not a browser
 * session — which is why it is verified HERE, in the Node route, and not in the
 * Edge proxy (the proxy can't reach Mongo, and a static key isn't a signed
 * token). The proxy simply steps aside for /api/partner/* so each route
 * self-authenticates. A partner credential is a pair of headers, never a cookie
 * or the x-admin-internal header, so it can never satisfy the admin gate.
 *
 * Every route wraps its handler in withPartnerAuth(route, handler). The wrapper:
 *   1. 404s when the feature is disabled (PARTNER_API_SECRET unset) — inert.
 *   2. Rate-limits auth FAILURES per IP (slows credential brute-forcing) and
 *      overall throughput per partner.
 *   3. Verifies X-Partner-Id + X-Partner-Secret in constant time (scrypt), with
 *      a dummy hash on the unknown-id path so ids can't be enumerated by timing.
 *   4. Rejects inactive partners.
 *   5. Audits the outcome and, on success, hands the handler the partner record.
 */

// After this many auth failures from one IP within the window, lock it out.
const AUTH_MAX_FAILURES = 10;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

// Overall request ceiling per credential, to bound a leaked key's damage and
// protect the carrier accounts from a runaway integration.
const THROUGHPUT_MAX = 120;
const THROUGHPUT_WINDOW_MS = 60 * 1000;

const HDR_ID = 'x-partner-id';
const HDR_SECRET = 'x-partner-secret';

export interface PartnerContext {
  partner: PartnerRecord;
  ip: string;
  keyId: string;
}

type PartnerHandler = (req: NextRequest, ctx: PartnerContext) => Promise<NextResponse>;

function unauthorized(): NextResponse {
  // Deliberately generic — never reveal whether the id or the secret was wrong.
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function withPartnerAuth(route: string, handler: PartnerHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const ip = clientIp(req);

    // 1. Feature master switch — fully inert (as if the route doesn't exist).
    if (!partnerApiEnabled()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // 2a. Already locked out for repeated auth failures?
    const failKey = `partner-auth:${ip}`;
    if ((await peek(failKey, AUTH_WINDOW_MS)) >= AUTH_MAX_FAILURES) {
      await logPartnerEvent({ ok: false, route, ip, status: 429, reason: 'locked_out' });
      return NextResponse.json(
        { error: 'Too many attempts. Please wait and try again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(AUTH_WINDOW_MS / 1000)) } }
      );
    }

    const keyId = req.headers.get(HDR_ID)?.trim() ?? '';
    const secret = req.headers.get(HDR_SECRET) ?? '';

    // 3. Verify. Unknown keyId still burns the scrypt cost (no timing oracle).
    const record = keyId ? await getPartnerByKeyId(keyId) : null;
    const ok = record ? verifyPartnerSecret(record, secret) : dummyVerify(secret);

    if (!record || !ok || !record.active) {
      await hit(failKey, AUTH_WINDOW_MS);
      await logPartnerEvent({
        ok: false,
        route,
        ip,
        keyId: keyId || undefined,
        status: 401,
        reason: !record ? 'unknown_key' : !ok ? 'bad_secret' : 'inactive',
      });
      return unauthorized();
    }

    // 4. Throughput ceiling per credential.
    const rate = await hit(`partner:${record.partnerId}`, THROUGHPUT_WINDOW_MS);
    if (rate > THROUGHPUT_MAX) {
      await logPartnerEvent({
        ok: false,
        route,
        ip,
        keyId,
        partnerId: record.partnerId,
        status: 429,
        reason: 'rate_limited',
      });
      return NextResponse.json(
        { error: 'Rate limit exceeded. Slow down and retry.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(THROUGHPUT_WINDOW_MS / 1000)) } }
      );
    }

    // 5. Authenticated. Stamp usage (best-effort) and run the handler.
    void touchPartnerUsed(record.partnerId);
    try {
      return await handler(req, { partner: record, ip, keyId });
    } catch (err: unknown) {
      // A handler crash must not leak internals to the partner.
      await logPartnerEvent({
        ok: false,
        route,
        ip,
        keyId,
        partnerId: record.partnerId,
        status: 500,
        reason: err instanceof Error ? err.message.slice(0, 200) : 'handler_error',
      });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  };
}
