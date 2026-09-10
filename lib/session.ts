/**
 * Edge-safe signed session tokens (2026-09-10).
 *
 * WHY: the admin_session cookie was sha256(ADMIN_PASSCODE) — one static value,
 * equal to a hash of the password, identical on every device forever, with no
 * server-enforced expiry. Anyone who ever saw the cookie held a plaintext-
 * equivalent copy of the passcode (and a short PIN is offline-crackable from it).
 *
 * This mints an HMAC-signed token that carries its own expiry, keyed by a
 * SEPARATE secret (SESSION_SECRET, never the passcode). The cookie no longer
 * reveals anything about the passcode; `exp` is checked on every request;
 * rotating SESSION_SECRET invalidates every token at once.
 *
 * Web Crypto ONLY — no Node APIs, no Mongo — so the very same code verifies
 * inside the Edge proxy (which cannot use the Mongo driver) and signs in the
 * Node auth route.
 *
 * Gated on SESSION_SECRET: while it is unset, sessionMode() is false and the app
 * keeps its legacy cookie unchanged. This module is inert until you configure
 * the secret — set SESSION_SECRET (long, random) and, at the same time, rotate
 * ADMIN_PASSCODE to a strong non-numeric value.
 *
 * TRADE-OFF: a stateless token cannot be revoked server-side short of rotating
 * SESSION_SECRET (which logs everyone out). That is acceptable and deliberate —
 * a per-session revocation list would require a DB lookup the Edge runtime can't
 * perform. Expiry is bounded by SESSION_TTL_SECONDS regardless.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/**
 * UTF-8 bytes with a guaranteed plain-ArrayBuffer backing. TextEncoder.encode is
 * typed `Uint8Array<ArrayBufferLike>`, which the Web Crypto `BufferSource`
 * parameters (typed over `ArrayBuffer`) reject under TS 5.7+; copying fixes the
 * type without changing behavior.
 */
function bytes(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(ENC.encode(s));
}

/** 8 hours — matches the legacy cookie's window. */
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True once SESSION_SECRET is configured — the switch that turns this on. */
export function sessionMode(): boolean {
  return Boolean(process.env.SESSION_SECRET);
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    bytes(process.env.SESSION_SECRET ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Mint a signed token valid for `ttlSeconds`. Payload is {iat, exp, jti}. */
export async function signSession(ttlSeconds: number = SESSION_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + ttlSeconds,
    jti: b64urlFromBytes(crypto.getRandomValues(new Uint8Array(9))),
  };
  const body = b64urlFromBytes(ENC.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), bytes(body));
  return `${body}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

/** Verify signature and expiry. False for anything malformed, unsigned, or expired. */
export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token || !sessionMode()) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = bytesFromB64url(sig);
  } catch {
    return false;
  }
  // crypto.subtle.verify is constant-time internally.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(), sigBytes, bytes(body));
  if (!ok) return false;
  try {
    const payload = JSON.parse(DEC.decode(bytesFromB64url(body))) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
