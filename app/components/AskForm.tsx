"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

export default function AskForm() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
    company: "", // honeypot — must stay empty
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Something went wrong (${res.status}).`);
      }
      setStatus("sent");
      setFormData({ name: "", email: "", phone: "", message: "", company: "" });
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send message.");
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy transition-all duration-200 focus:border-blue focus:ring-2 focus:ring-blue/20 focus:outline-none";

  if (status === "sent") {
    return (
      <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-base font-semibold text-green-800">Thanks for reaching out!</p>
        <p className="mt-1 text-sm text-green-700">
          We&apos;ve received your message and will get back to you shortly.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-medium text-blue hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-navy/80">
          Name
        </label>
        <input type="text" id="name" name="name" required value={formData.name} onChange={handleChange} className={inputClass} />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-navy/80">
          Email
        </label>
        <input type="email" id="email" name="email" required value={formData.email} onChange={handleChange} className={inputClass} />
      </div>
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-navy/80">
          Phone
        </label>
        <input type="tel" id="phone" name="phone" value={formData.phone} onChange={handleChange} className={inputClass} />
      </div>
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-navy/80">
          Message
        </label>
        <textarea id="message" name="message" required rows={4} value={formData.message} onChange={handleChange} className={inputClass} />
      </div>

      {/* Honeypot: hidden from users, tempting to bots. Left empty by humans. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="company">Company</label>
        <input
          type="text"
          id="company"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={formData.company}
          onChange={handleChange}
        />
      </div>

      {status === "error" && errorMsg && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-navy hover:shadow-lg disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Send Message"}
      </button>
    </form>
  );
}
