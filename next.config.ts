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
  // CSP in REPORT-ONLY mode (2026-09-10): it never blocks — it only reports
  // violations to the browser console — so it is safe to ship and observe. The
  // policy below is close to what we'd enforce; it still carries 'unsafe-inline'
  // (Next hydration + the JSON-LD block) and 'unsafe-eval' (the vendored Epson
  // ePOS SDK). Tightening those (a nonce for inline; scoping 'unsafe-eval' to
  // /admin) and switching to the enforcing Content-Security-Policy header is a
  // deliberate follow-up — do it after watching the report-only console for a
  // real counter session.
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://api.stripe.com https://*.blob.vercel-storage.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com https://www.google.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
