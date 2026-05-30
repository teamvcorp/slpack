import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendError } from '@/lib/errorLog';
import type { CarrierKey, ErrorLogEntry } from '@/app/admin/types/shipping';

const MAX_UPSTREAM_BODY_CHARS = 2000;

export interface LogAndRespondInput {
  /** Route identifier, e.g. 'shipping/fedex' */
  route: string;
  carrier?: CarrierKey;
  /** HTTP status to return to the client */
  status: number;
  /** Short human-readable error message returned in the response */
  message: string;
  /** Upstream carrier HTTP status, when the failure was a forwarded response */
  upstreamStatus?: number;
  /** Upstream response body (will be truncated to ~2 KB before storage) */
  upstreamBody?: string;
  /** Sanitized request summary — caller is responsible for stripping PII */
  requestSummary?: Record<string, unknown>;
  /** Optional caught error to capture a stack trace from (dev only in response) */
  err?: unknown;
}

/**
 * Logs a structured error to the server console, persists it to MongoDB
 * (fire-and-forget, never throws), and returns a `NextResponse`.
 *
 * In production the response body is minimal (`{ error }`). In development the
 * response also includes `upstreamStatus`, `upstreamBody` (truncated), and the
 * error stack to aid debugging. The full payload is always written to the log.
 */
export async function logAndRespond(input: LogAndRespondInput): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== 'production';

  const upstreamBody =
    input.upstreamBody && input.upstreamBody.length > MAX_UPSTREAM_BODY_CHARS
      ? input.upstreamBody.slice(0, MAX_UPSTREAM_BODY_CHARS) + '…[truncated]'
      : input.upstreamBody;

  const stack =
    input.err instanceof Error && input.err.stack ? input.err.stack : undefined;

  const entry: ErrorLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    route: input.route,
    carrier: input.carrier,
    status: input.status,
    message: input.message,
    upstreamStatus: input.upstreamStatus,
    upstreamBody,
    requestSummary: input.requestSummary,
    stack: isDev ? stack : undefined,
  };

  // Single structured line — easy to grep in `next dev` and Vercel runtime logs
  console.error('[api-error]', JSON.stringify(entry));

  // Fire-and-forget persistence; appendError swallows its own errors
  await appendError(entry);

  const responseBody: Record<string, unknown> = { error: input.message };
  if (isDev) {
    if (input.upstreamStatus !== undefined) responseBody.upstreamStatus = input.upstreamStatus;
    if (upstreamBody) responseBody.upstreamBody = upstreamBody;
    if (stack) responseBody.stack = stack;
  }

  return NextResponse.json(responseBody, { status: input.status });
}
