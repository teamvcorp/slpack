/**
 * Client helper for in-person card payments on the Stripe Terminal reader (S710).
 *
 * All Stripe calls happen server-side (the reader talks to Stripe's cloud, not the
 * browser). This module just: checks whether the reader is enabled, kicks off a
 * payment, polls until it resolves, and can cancel. Mirrors the caching style of
 * receiptPrinter.ts.
 */

export type TerminalStatus = 'in_progress' | 'succeeded' | 'failed' | 'canceled' | 'error';

/** Amount payload for a reader charge — register/combined send items, shipping sends amountUSD. */
export interface ReaderChargePayload {
  items?: unknown[];
  taxRate?: number;
  shippingUSD?: number;
  amountUSD?: number;
  description?: string;
  customerEmail?: string;
}

export interface StartResult {
  paymentIntentId: string;
  amountUSD: number;
  subtotalUSD?: number;
  taxUSD?: number;
}

const SETTINGS_TTL_MS = 60_000;
const POLL_INTERVAL_MS = 1800;
const POLL_TIMEOUT_MS = 90_000;

let enabledCache: boolean | null = null;
let enabledFetchedAt = 0;

/** Bust the enabled cache (call after saving terminal settings). */
export function refreshTerminalSettings(): void {
  enabledCache = null;
  enabledFetchedAt = 0;
}

/** Whether a reader is paired and enabled (cached ~60s). Safe on any failure → false. */
export async function getTerminalEnabled(): Promise<boolean> {
  if (enabledCache !== null && Date.now() - enabledFetchedAt < SETTINGS_TTL_MS) return enabledCache;
  try {
    const res = await fetch('/api/admin/settings/terminal', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      enabledCache = Boolean(d.enabled) && Boolean(d.readerId);
      enabledFetchedAt = Date.now();
      return enabledCache;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** Create the PaymentIntent and push it to the reader. Throws with the server message on failure. */
export async function startReaderPayment(payload: ReaderChargePayload): Promise<StartResult> {
  const res = await fetch('/api/terminal/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.paymentIntentId) {
    throw new Error(data.error ?? `Server error ${res.status}`);
  }
  return data as StartResult;
}

/** Ask the reader to cancel the in-progress action and void the PaymentIntent. */
export async function cancelReaderPayment(paymentIntentId: string): Promise<void> {
  try {
    await fetch('/api/terminal/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId }),
    });
  } catch {
    /* best effort */
  }
}

/**
 * Poll until the payment reaches a terminal state (or times out). Returns the
 * final status; on 'failed'/'error' the message explains why. `signal` lets the
 * UI abort (e.g. the operator pressed Cancel).
 */
export async function waitForReader(
  paymentIntentId: string,
  opts: { onTick?: (status: TerminalStatus) => void; signal?: AbortSignal } = {}
): Promise<{ status: TerminalStatus; failureMessage?: string }> {
  const started = Date.now();

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    if (opts.signal?.aborted) return { status: 'canceled' };

    let data: { status?: TerminalStatus; failureMessage?: string } = {};
    try {
      const res = await fetch('/api/terminal/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId }),
        signal: opts.signal,
      });
      data = await res.json().catch(() => ({}));
    } catch (err) {
      if (opts.signal?.aborted) return { status: 'canceled' };
      // Transient network hiccup — keep polling.
      data = { status: 'in_progress' };
      void err;
    }

    const status = (data.status ?? 'in_progress') as TerminalStatus;
    opts.onTick?.(status);

    if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
      return { status, failureMessage: data.failureMessage };
    }
    // 'error' is treated as transient here — keep polling until timeout.

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return { status: 'failed', failureMessage: 'Timed out waiting for the reader.' };
}
