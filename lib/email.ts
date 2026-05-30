/**
 * Lightweight RFC-5322-ish email validator. Good enough to keep obviously
 * invalid values (empty, missing @, missing TLD, whitespace) from being sent
 * to Stripe / Resend, which both reject malformed addresses with cryptic errors.
 *
 * Returns the trimmed email when valid, or undefined otherwise.
 */
export function sanitizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Basic shape: local@domain.tld with no whitespace and at most one @.
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(trimmed) ? trimmed : undefined;
}
