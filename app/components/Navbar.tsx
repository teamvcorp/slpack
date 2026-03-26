"use client";

import Link from "next/link";
import { useState } from "react";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  const links = [
    { label: "Home", href: "#" },
    { label: "Shipping", href: "#shipping" },
    { label: "Packing", href: "#packing" },
    { label: "Solutions", href: "#solutions" },
  ];

  return (
    <nav className="flex items-center">
      {/* Desktop links */}
      <ul className="hidden items-center gap-1 md:flex">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="relative px-3 py-2 text-sm font-medium text-navy/70 transition-colors duration-200 after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-0 after:-translate-x-1/2 after:rounded-full after:bg-blue after:transition-all after:duration-300 hover:text-navy hover:after:w-2/3"
            >
              {link.label}
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="#contact"
            className="ml-2 rounded-lg bg-blue px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-navy hover:shadow-md"
          >
            Contact Us
          </Link>
        </li>
      </ul>

      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-xl text-navy transition-all duration-200 hover:bg-cream hover:text-blue md:hidden"
        aria-label="Toggle menu"
      >
        {isOpen ? "✕" : "☰"}
      </button>

      {/* Mobile links */}
      <div
        className={`absolute left-0 right-0 top-full border-b border-navy/10 bg-white/95 backdrop-blur-sm transition-all duration-300 ease-in-out md:hidden ${
          isOpen ? "max-h-80 opacity-100 shadow-lg" : "max-h-0 opacity-0 overflow-hidden"
        }`}
      >
        <ul className="space-y-1 px-6 py-4">
          {links.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-navy/70 transition-all duration-200 hover:bg-cream hover:text-navy"
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li className="pt-2">
            <Link
              href="#contact"
              onClick={() => setIsOpen(false)}
              className="block rounded-lg bg-blue px-3 py-2.5 text-center text-sm font-semibold text-white transition-all duration-200 hover:bg-navy"
            >
              Contact Us
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}