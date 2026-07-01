/**
 * Normalize a postal code before sending it to a carrier's API.
 *
 * US carriers (UPS, FedEx) reject a ZIP+4 written with a hyphen — e.g.
 * "23225-4647" comes back as UPS error 111542 "Invalid Destination". Rating and
 * labeling only need the 5-digit base ZIP, which is always accepted, so for US
 * addresses we strip to the first five digits. Non-US postal codes (which may be
 * alphanumeric, e.g. Canada "K1A 0B1") are passed through trimmed and untouched.
 */
export function normalizePostal(zip: unknown, country?: unknown): string {
  const raw = String(zip ?? '').trim();
  const isUS = !country || String(country).trim().toUpperCase() === 'US';
  if (!isUS) return raw;
  return raw.replace(/\D/g, '').slice(0, 5);
}
