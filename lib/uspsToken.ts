export const BASE = 'https://api.usps.com';

// USPS OAuth tokens are valid for 8 hours (28 800 s).
// Cache the token in module scope so the same warm server instance reuses it.
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Unix ms

export async function getUspsToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(`${BASE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.USPS_CLIENT_ID!,
      client_secret: process.env.USPS_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`USPS auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token as string;

  // Honour expires_in if the API returns it; fall back to 8 hours.
  const expiresInSec: number =
    typeof data.expires_in === 'number' && data.expires_in > 0
      ? data.expires_in
      : 8 * 60 * 60;

  // Refresh 60 s before actual expiry to avoid using a token right at its edge.
  tokenExpiresAt = now + (expiresInSec - 60) * 1000;

  return cachedToken;
}
