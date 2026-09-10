import type { NextConfig } from "next";

/**
 * Security response headers (added 2026-09-10). Applied to every route.
 *
 * Content-Security-Policy is deliberately NOT here yet. The vendored Epson ePOS
 * SDK (public/ePOS_SDK_JavaScript_v2.27.0i/epos-2.27.0.js) uses eval/new
 * Function, so a strict script-src would break receipt printing unless
 * 'unsafe-eval' is scoped to /admin only — that needs its own audited step. The
 * headers below carry no such risk and ship now.
 */
const SECURITY_HEADERS = [
  // Force HTTPS for two years, including subdomains; eligible for preload lists.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Never let a browser MIME-sniff a response. Directly matters for the label
  // route, which serves bytes it type-sniffs itself.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full admin URLs (which carry shipment ids) in the Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Clickjacking: nothing here needs to be framed by another site. The app's
  // own print iframe is written to in-process (document.write), which this does
  // not govern, so DENY is safe.
  { key: "X-Frame-Options", value: "DENY" },
  // Drop powerful features the app never uses.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
