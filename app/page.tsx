import Header from "./components/Header";
import Hero from "./components/Hero";
import Link from "next/link";
import Image from "next/image";
import Card from "./components/Card";
import AskForm from "./components/AskForm";
import { Footer } from "./components/Footer";

export default function Home() {
  return (
    <>
      <main className="min-h-screen bg-cream">
        <section className="mx-auto max-w-6xl bg-white shadow-sm">
          <Header />
          <Hero />

          {/* Shipping section */}
          <section id="shipping" className="px-8 py-16">
            <h2 className="text-center text-3xl font-bold text-navy">
              Shipping Made Easy
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-navy/70">
              Whether you are sending a package across town or across the
              country, we make it simple. Our team provides expert packing,
              trusted shipping options, and high-quality printing, all in one
              convenient location. No guesswork, no stress  just dependable
              service every time.
            </p>
            <div className="mt-4 text-center">
              <Link
                href="#contact"
                className="inline-block rounded-lg bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-navy hover:shadow-lg"
              >
                Visit us Today
              </Link>
            </div>
            <div className="mt-10 flex flex-col items-center gap-10 md:flex-row">
              <div className="flex-1">
                <p className="text-navy/70">
                  We offer multiple carrier options so you can choose the speed
                  and price that works best for you.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-navy/80">
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Domestic &amp; international shipping</li>
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Ground, express, and overnight options</li>
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Tracking and delivery confirmation</li>
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Insurance available for valuable items</li>
                </ul>
                <p className="mt-6 font-semibold text-navy">Carriers we work with:</p>
                <div className="mt-2 flex gap-4 text-sm font-medium text-navy/70">
                  <span className="rounded-md bg-cream px-3 py-1">UPS</span>
                  <span className="rounded-md bg-cream px-3 py-1">FedEx</span>
                  <span className="rounded-md bg-cream px-3 py-1">USPS</span>
                </div>
              </div>
              <div className="flex-1 overflow-hidden rounded-xl">
                <Image
                  src="/images/boxing.jpeg"
                  alt="Packing a box for shipping"
                  width={500}
                  height={300}
                  className="h-auto w-full rounded-xl object-cover transition-transform duration-500 hover:scale-105"
                />
              </div>
            </div>
          </section>

          {/* Packing section */}
          <section id="packing" className="bg-lightBlue px-8 py-16">
            <div className="flex flex-col items-center gap-10 md:flex-row">
              <div className="flex-1">
                <h2 className="text-3xl font-bold text-navy">Professional Packing</h2>
                <p className="mt-3 text-navy/70">Protect your items with expert packing done right.</p>
                <ul className="mt-4 space-y-2 text-sm text-navy/80">
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Custom packing for fragile or valuable items</li>
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Boxes, bubble wrap, and specialty materials</li>
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Artwork, electronics, antiques, and more</li>
                  <li className="flex items-center gap-2"><span className="text-blue"></span> Peace of mind knowing it&apos;s packed securely</li>
                </ul>
                <Link
                  href="#contact"
                  className="mt-6 inline-block rounded-lg bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-navy hover:shadow-lg"
                >
                  Visit us Today
                </Link>
              </div>
              <div className="flex-1 overflow-hidden rounded-xl">
                <Image
                  src="/images/packer.png"
                  alt="Professional packing services"
                  width={500}
                  height={300}
                  className="h-auto w-full rounded-xl object-cover transition-transform duration-500 hover:scale-105"
                />
              </div>
            </div>
          </section>

          {/* Business Solutions section */}
          <section id="solutions" className="px-8 py-16">
            <h2 className="text-center text-3xl font-bold text-navy">Business Solutions</h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-3">
              <Card
                title="Bulk Shipping"
                icon=""
                features={[
                  "Volume discounts available",
                  "Scheduled pickups",
                  "Dedicated account support",
                  "Multi-carrier options",
                ]}
              />
              <Card
                title="Print & Copy"
                icon=""
                features={[
                  "Black & white and color printing",
                  "Binding and laminating",
                  "Business cards & flyers",
                  "Large-format printing",
                ]}
              />
              <Card
                title="Mailbox Rental"
                icon=""
                features={[
                  "Secure private mailbox",
                  "Package receiving & holding",
                  "Mail forwarding available",
                  "24/7 access options",
                ]}
              />
            </div>
          </section>

          {/* Contact section */}
          <section id="contact" className="bg-cream px-8 py-16">
            <h2 className="text-center text-3xl font-bold text-navy">Contact Us</h2>
            <div className="mt-10 flex flex-col gap-10 md:flex-row">
              {/* FAQ + Map */}
              <div className="flex-1 space-y-6">
                <div className="rounded-xl bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-navy">Frequently Asked Questions</h3>
                  <dl className="mt-4 space-y-4 text-sm">
                    <div>
                      <dt className="font-medium text-navy">What&apos;s the cheapest way to ship my package?</dt>
                      <dd className="mt-1 text-navy/70">We compare carriers and help you choose the best option based on your needs.</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-navy">Can you pack fragile items?</dt>
                      <dd className="mt-1 text-navy/70">Yes! We specialize in packing delicate and valuable items safely.</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-navy">Do you offer international shipping?</dt>
                      <dd className="mt-1 text-navy/70">Absolutely  we ship worldwide with multiple carrier options.</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-navy">How long does printing take?</dt>
                      <dd className="mt-1 text-navy/70">Most jobs are completed quickly, often same-day depending on volume.</dd>
                    </div>
                  </dl>
                </div>
                <div className="overflow-hidden rounded-xl border border-navy/10">
                  <iframe
                    title="Storm Lake Pack and Ship Location"
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2930.0!2d-95.209!3d42.643!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s!2s503+Lake+Ave%2C+Storm+Lake%2C+IA+50588!5e0!3m2!1sen!2sus!4v1"
                    width="100%"
                    height="250"
                    style={{ border: 0 }}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </div>
              {/* Form + Info */}
              <div className="flex-1">
                <div className="rounded-xl bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-navy">Send us a Message</h3>
                  <AskForm />
                </div>
                <div className="mt-6 space-y-2 text-center text-sm text-navy/70">
                  <p className="font-semibold text-navy">503 Lake Ave, Storm Lake, IA 50588</p>
                  <p>(712) 560-1128</p>
                  <p>shipit@slpacknship.com</p>
                </div>
              </div>
            </div>
          </section>

          <Footer />
        </section>
      </main>
    </>
  );
}