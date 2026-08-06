import type { Metadata } from "next";
import Link from "next/link";
import Header from "../components/Header";
import { Footer } from "../components/Footer";
import PrintOrderForm from "../components/PrintOrderForm";
import { PRINT_PRICING, LAMINATION_PER_PAGE } from "@/lib/printPricing";

export const metadata: Metadata = {
  title: "Printing & Copy",
  description:
    "Send us your PDF or Word documents to print — black & white or color, collated and stapled. Upload any size and we'll have it ready. Storm Lake Pack & Ship.",
  alternates: { canonical: "/printing" },
};

const bw = PRINT_PRICING.bw;
const color = PRINT_PRICING.color;

export default function PrintingPage() {
  return (
    <main className="min-h-screen bg-cream">
      <section className="mx-auto max-w-6xl bg-white shadow-sm">
        <Header />

        {/* Intro */}
        <section className="px-8 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue">
              Printing &amp; Copy
            </p>
            <h1 className="mt-2 text-3xl font-bold text-navy sm:text-4xl">
              Send us your documents to print
            </h1>
            <p className="mt-4 text-navy/70">
              Upload PDF or Word files — <strong>any size</strong>, as many as you need. Choose black
              &amp; white or color, collated and stapled, and we&apos;ll have them ready. We can even
              email the finished files to someone for you.
            </p>
          </div>

          {/* Pricing */}
          <div className="mx-auto mt-10 grid max-w-2xl gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-navy/10 bg-cream px-6 py-5 text-left shadow-sm">
              <h2 className="text-lg font-semibold text-navy">Black &amp; white</h2>
              <p className="mt-2 text-3xl font-extrabold text-navy">
                {bw.tierRate * 100}¢<span className="text-base font-medium text-navy/50">/page</span>
              </p>
              <p className="mt-1 text-sm text-navy/60">
                First {bw.tierPages} pages, then <strong>{bw.overRate * 100}¢</strong> each after.
              </p>
            </div>
            <div className="rounded-xl border border-blue/30 bg-[#EBF7FF] px-6 py-5 text-left shadow-sm">
              <h2 className="text-lg font-semibold text-navy">Color</h2>
              <p className="mt-2 text-3xl font-extrabold text-navy">
                {color.tierRate * 100}¢<span className="text-base font-medium text-navy/50">/page</span>
              </p>
              <p className="mt-1 text-sm text-navy/60">
                First {color.tierPages} pages, then <strong>{color.overRate * 100}¢</strong> each after.
              </p>
            </div>
          </div>

          <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-navy/60">
            Single- or double-sided, collated, stapled, and <strong>lamination ${LAMINATION_PER_PAGE}/page</strong> — all optional.
          </p>

          {/* Order form */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-navy/10 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-xl font-bold text-navy">Start a print order</h2>
            <p className="mt-1 text-sm text-navy/60">
              Fill in your details, upload your documents, and we&apos;ll confirm the final price.
            </p>
            <PrintOrderForm />
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
