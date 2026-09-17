import type { Metadata } from "next";
import Link from "next/link";
import Header from "../components/Header";
import { Footer } from "../components/Footer";
import FaxRequestForm from "../components/FaxRequestForm";
import { FAX_PRICING, money } from "@/lib/faxPricing";
import { SITE } from "@/lib/siteConfig";

export const metadata: Metadata = {
  title: "Send & Receive a Fax",
  description:
    "Send a fax from Storm Lake Pack & Ship — upload a PDF or email it to us. $2.00 first page, $1.00 each additional, free cover page. Receive faxes here and we'll print them for pickup.",
  alternates: { canonical: "/fax" },
};

const out = FAX_PRICING.outbound;
const inb = FAX_PRICING.inbound;

export default function FaxPage() {
  const mailto = `mailto:${SITE.email}?subject=${encodeURIComponent('Fax request')}`;

  return (
    <main className="min-h-screen bg-cream">
      <section className="mx-auto max-w-6xl bg-white shadow-sm">
        <Header />

        <section className="px-8 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue">Fax Service</p>
            <h1 className="mt-2 text-3xl font-bold text-navy sm:text-4xl">Send or receive a fax</h1>
            <p className="mt-4 text-navy/70">
              No fax machine needed. Upload your PDF below or email it to us, tell us the number,
              and we&apos;ll send it. Need to <strong>receive</strong> one? Have it sent to our
              number and we&apos;ll print it and hold it for pickup.
            </p>
          </div>

          {/* Pricing */}
          <div className="mx-auto mt-10 grid max-w-2xl gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-navy/10 bg-cream px-6 py-5 text-left shadow-sm">
              <h2 className="text-lg font-semibold text-navy">Sending</h2>
              <p className="mt-2 text-3xl font-extrabold text-navy">
                {money(out.firstPage)}
                <span className="text-base font-medium text-navy/50">/first page</span>
              </p>
              <p className="mt-1 text-sm text-navy/60">
                Then <strong>{money(out.additionalPage)}</strong> each additional page.
              </p>
              <p className="mt-2 text-sm font-semibold text-blue">Cover page free</p>
            </div>
            <div className="rounded-xl border border-blue/30 bg-[#EBF7FF] px-6 py-5 text-left shadow-sm">
              <h2 className="text-lg font-semibold text-navy">Receiving</h2>
              <p className="mt-2 text-3xl font-extrabold text-navy">
                {money(inb.perPage)}
                <span className="text-base font-medium text-navy/50">/page</span>
              </p>
              <p className="mt-1 text-sm text-navy/60">Printed and held for pickup.</p>
              <p className="mt-2 text-sm text-navy/70">
                Have it sent to{' '}
                <span className="font-semibold text-navy">{SITE.faxDisplay}</span>
              </p>
            </div>
          </div>

          {/* Request form */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-navy/10 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-xl font-bold text-navy">Send a fax</h2>
            <p className="mt-1 text-sm text-navy/60">
              Upload your PDF and we&apos;ll confirm the total before it goes out.
            </p>
            <FaxRequestForm />
          </div>

          {/* Email alternative — same job, no upload */}
          <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-navy/10 bg-cream px-6 py-5 text-center">
            <p className="text-sm font-semibold text-navy">Prefer email?</p>
            <p className="mt-1 text-sm text-navy/60">
              Send your PDF to{' '}
              <a href={mailto} className="font-semibold text-blue hover:underline">
                {SITE.email}
              </a>{' '}
              and include the fax number you want it sent to.
            </p>
          </div>

          <div className="mx-auto mt-8 max-w-2xl text-center">
            <Link href="/" className="text-sm font-medium text-blue hover:underline">
              ← Back to Storm Lake Pack &amp; Ship
            </Link>
          </div>
        </section>

        <Footer />
      </section>
    </main>
  );
}
