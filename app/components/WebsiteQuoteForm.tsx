"use client";

import { useRef, useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

// Mirror of the server-side limits in app/api/website-quote/route.ts (UX pre-check).
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf";

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  hasLogo: "",
  hasDomain: "",
  domainName: "",
  designParams: "",
  siteDescription: "",
  servicesDescription: "",
  company: "", // honeypot — must stay empty
};

export default function WebsiteQuoteForm() {
  const [formData, setFormData] = useState({ ...EMPTY });
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setErrorMsg(null);
    if (picked.length > MAX_FILES) {
      setErrorMsg(`Please attach at most ${MAX_FILES} files.`);
      return;
    }
    if (picked.some((f) => f.size > MAX_FILE_BYTES)) {
      setErrorMsg("Each file must be 10 MB or smaller.");
      return;
    }
    if (picked.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      setErrorMsg("Attachments total more than 20 MB.");
      return;
    }
    setFiles(picked);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    try {
      const payload = new FormData();
      Object.entries(formData).forEach(([k, v]) => payload.append(k, v));
      files.forEach((f) => payload.append("files", f));

      // No Content-Type header — the browser sets the multipart boundary.
      const res = await fetch("/api/website-quote", { method: "POST", body: payload });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Something went wrong (${res.status}).`);
      }
      setStatus("sent");
      setFormData({ ...EMPTY });
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send your request.");
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy transition-all duration-200 focus:border-blue focus:ring-2 focus:ring-blue/20 focus:outline-none";
  const labelClass = "block text-sm font-medium text-navy/80";

  if (status === "sent") {
    return (
      <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-base font-semibold text-green-800">Thanks — we&apos;ve got your details!</p>
        <p className="mt-1 text-sm text-green-700">
          Our web team will review your project and get back to you shortly.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-medium text-blue hover:underline"
        >
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="wq-name" className={labelClass}>Name</label>
          <input type="text" id="wq-name" name="name" required value={formData.name} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="wq-email" className={labelClass}>Email</label>
          <input type="email" id="wq-email" name="email" required value={formData.email} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="wq-phone" className={labelClass}>Phone <span className="text-navy/40">(optional)</span></label>
          <input type="tel" id="wq-phone" name="phone" value={formData.phone} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="wq-hasLogo" className={labelClass}>Do you have a logo?</label>
          <select id="wq-hasLogo" name="hasLogo" value={formData.hasLogo} onChange={handleChange} className={inputClass}>
            <option value="">Select…</option>
            <option value="yes">Yes — I&apos;ll upload it below</option>
            <option value="no">No — I need one</option>
          </select>
        </div>
        <div>
          <label htmlFor="wq-hasDomain" className={labelClass}>Do you have a domain?</label>
          <select id="wq-hasDomain" name="hasDomain" value={formData.hasDomain} onChange={handleChange} className={inputClass}>
            <option value="">Select…</option>
            <option value="yes">Yes</option>
            <option value="no">No — I need one</option>
          </select>
        </div>
        {formData.hasDomain === "yes" && (
          <div>
            <label htmlFor="wq-domainName" className={labelClass}>Domain name</label>
            <input type="text" id="wq-domainName" name="domainName" placeholder="example.com" value={formData.domainName} onChange={handleChange} className={inputClass} />
          </div>
        )}
      </div>

      <div>
        <label htmlFor="wq-siteDescription" className={labelClass}>What is the site for?</label>
        <textarea id="wq-siteDescription" name="siteDescription" required rows={3} placeholder="Tell us about your business and what the website needs to do." value={formData.siteDescription} onChange={handleChange} className={inputClass} />
      </div>
      <div>
        <label htmlFor="wq-servicesDescription" className={labelClass}>Products or services to feature <span className="text-navy/40">(optional)</span></label>
        <textarea id="wq-servicesDescription" name="servicesDescription" rows={2} value={formData.servicesDescription} onChange={handleChange} className={inputClass} />
      </div>
      <div>
        <label htmlFor="wq-designParams" className={labelClass}>Design preferences <span className="text-navy/40">(optional)</span></label>
        <textarea id="wq-designParams" name="designParams" rows={2} placeholder="Colors, style, fonts, sites you like…" value={formData.designParams} onChange={handleChange} className={inputClass} />
      </div>

      <div>
        <label htmlFor="wq-files" className={labelClass}>
          Upload logo or design files <span className="text-navy/40">(optional — images or PDF)</span>
        </label>
        <input
          ref={fileRef}
          type="file"
          id="wq-files"
          name="files"
          multiple
          accept={ACCEPT}
          onChange={handleFiles}
          className="mt-1 w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy file:mr-3 file:rounded-md file:border-0 file:bg-blue/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue hover:file:bg-blue/20"
        />
        {files.length > 0 && (
          <p className="mt-1 text-xs text-navy/50">
            {files.length} file{files.length > 1 ? "s" : ""} selected
          </p>
        )}
      </div>

      {/* Honeypot: hidden from users, tempting to bots. Left empty by humans. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="wq-company">Company</label>
        <input type="text" id="wq-company" name="company" tabIndex={-1} autoComplete="off" value={formData.company} onChange={handleChange} />
      </div>

      {status === "error" && errorMsg && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-navy hover:shadow-lg disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Request my website quote"}
      </button>
    </form>
  );
}
