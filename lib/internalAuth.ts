import { createHash } from 'crypto';

/** Header used by trusted server-to-server API calls to pass the proxy gate. */
export const INTERNAL_HEADER = 'x-admin-internal';

/**
 * Token presented by internal server-to-server fetches (same value the proxy
 * derives from ADMIN_PASSCODE and stores in the admin_session cookie). When no
 * passcode is configured the proxy allows everything, so the value is unused.
 */
export function internalApiToken(): string {
  return createHash('sha256').update(process.env.ADMIN_PASSCODE ?? '').digest('hex');
}
