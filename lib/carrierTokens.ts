/**
 * Cached OAuth client-credentials tokens for FedEx and UPS.
 *
 * Tokens are valid ~1 hour (FedEx) / ~4 hours (UPS); previously every rate,
 * label, validate, void, pickup, and tracking call fetched a brand-new one.
 * This caches per process (per warm serverless instance) and refreshes a minute
 * before expiry, cutting latency and load on the carriers' token endpoints.
 */

const FEDEX_BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

const UPS_BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

interface Cached {
  token: string;
  expiresAt: number; // epoch ms
}

const cache: Record<string, Cached> = {};
const SAFETY_MS = 60_000; // refresh a minute early

async function getCached(
  key: string,
  fetcher: () => Promise<{ token: string; ttlSec: number }>
): Promise<string> {
  const now = Date.now();
  const hit = cache[key];
  if (hit && hit.expiresAt > now + SAFETY_MS) return hit.token;

  const { token, ttlSec } = await fetcher();
  cache[key] = { token, expiresAt: now + ttlSec * 1000 };
  return token;
}

export async function getFedexToken(): Promise<string> {
  return getCached('fedex', async () => {
    const res = await fetch(`${FEDEX_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.FEDEX_CLIENT_ID!,
        client_secret: process.env.FEDEX_CLIENT_SECRET!,
      }),
    });
    if (!res.ok) throw new Error(`FedEx auth failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return { token: data.access_token as string, ttlSec: Number(data.expires_in) || 3600 };
  });
}

export async function getUpsToken(): Promise<string> {
  return getCached('ups', async () => {
    const credentials = Buffer.from(
      `${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`
    ).toString('base64');
    const res = await fetch(`${UPS_BASE}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!res.ok) throw new Error(`UPS auth failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return { token: data.access_token as string, ttlSec: Number(data.expires_in) || 3600 };
  });
}
