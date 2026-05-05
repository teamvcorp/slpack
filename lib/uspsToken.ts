// Set USPS_SANDBOX=true to use the USPS test environment (apis-tem.usps.com).
// Test CRIDs/MIDs/EPS accounts must be registered on the test environment separately.
export const BASE =
  process.env.USPS_SANDBOX === 'true'
    ? 'https://apis-tem.usps.com'
    : 'https://api.usps.com';

// USPS OAuth tokens are valid for 8 hours (28 800 s).
// USPS does not use scopes — one token covers all APIs.
// Cache by scope key anyway so label/prices calls don't race each other.
const tokenCache: Record<string, { token: string; expiresAt: number }> = {};

export async function getUspsToken(scope: 'prices' | 'labels' | 'addresses' = 'prices'): Promise<string> {
  const now = Date.now();
  // All scopes share the same token — key on 'default'
  const cacheKey = 'default';
  const cached = tokenCache[cacheKey];
  if (cached && now < cached.expiresAt) {
    return cached.token;
  }

  const res = await fetch(`${BASE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.USPS_CLIENT_ID!,
      client_secret: process.env.USPS_CLIENT_SECRET!,
      // No scope parameter — USPS rejects it
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`USPS auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const token = data.access_token as string;

  const expiresInSec: number =
    typeof data.expires_in === 'number' && data.expires_in > 0
      ? data.expires_in
      : 8 * 60 * 60;

  tokenCache[cacheKey] = { token, expiresAt: now + (expiresInSec - 60) * 1000 };

  return token;
}
