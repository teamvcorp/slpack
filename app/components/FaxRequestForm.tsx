"use client";

import { useRef, useState } from "react";
import { PDF_ACCEPT, PDF_EXTENSIONS, findDisallowedFile, uploadDocuments } from "@/lib/clientUpload";
import { FAX_PRICING, computeFaxPrice, money } from "@/lib/faxPricing";

/**
 * Public fax request form — upload a PDF and tell us the number to send it to.
 *
 * Shares the upload path with PrintOrderForm via lib/clientUpload: the file goes
 * straight from the browser to Vercel Blob, and only the resulting URL is posted
 * to our API, which keeps this clear of the ~4.5 MB serverless body limit.
 *
 * The destination fax number is required and validated server-side with the same
 * toE164() the admin send path uses, so what staff dial is what the customer
 * typed. This form does not send anything — staff fax it once payment is taken.
 */

type Status = "idle" | "uploading" | "sending" | "sent" | "error";

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  faxTo: "",
  pages: "",
  notes: "",
  hp_check: "", // honeypot — must stay empty; odd name so autofill ignores it
};

export default function FaxRequestForm() {
  const [formData, setFormData] = useState({ ...EMPTY });
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pagesNum = Math.max(0, Number(formData.pages) || 0);
  const quote = pagesNum > 0 ? computeFaxPrice({ pages: pagesNum, direction: "outbound" }) : null;
  const busy = status === "uploading" || status === "sending";

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setErrorMsg(null);
    const bad = findDisallowedFile(picked, PDF_EXTENSIONS);
    if (bad) {
      setErrorMsg(`"${bad.name}" isn't a PDF. Faxes must be sent as PDF.`);
      return;
    }
    setFiles(picked);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (files.length === 0) {
      setErrorMsg("Please attach the PDF you want faxed.");
      return;
    }
    if (!formData.faxTo.trim()) {
      setErrorMsg("Enter the fax number to send to.");
      return;
    }

    try {
      setStatus("uploading");
      const uploaded = await uploadDocuments(files, {
        handleUploadUrl: "/api/fax-request/upload",
        onProgress: setProgress,
      });

      setStatus("sending");
      setProgress("Sending your request…");
      const res = await fetch("/api/fax-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, pages: pagesNum, files: uploaded }),
      });
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
    } finally {
      setProgress("");
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy transition-all duration-200 focus:border-blue focus:ring-2 focus:ring-blue/20 focus:outline-none";
  const labelClass = "block text-sm font-medium text-navy/80";

  if (status === "sent") {
    return (
      <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-base font-semibold text-green-800">Request received — thank you!</p>
        <p className="mt-1 text-sm text-green-700">
          We have your document and will fax it shortly. You&apos;ll get a confirmation by email, and
          payment is taken at the counter.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-medium text-blue hover:underline"
        >
          Send another fax
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5 text-left">
      {/* Honeypot — hidden from people, irresistible to bots. */}
      <input
        type="text"
        name="hp_check"
        value={formData.hp_check}
        onChange={handleChange}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {/* The one thing we can't guess */}
      <div className="rounded-xl border border-blue/30 bg-[#EBF7FF] p-4">
        <label htmlFor="fx-to" className={labelClass}>
          Fax number to send to <span className="text-red">*</span>
        </label>
        <input
          type="tel"
          id="fx-to"
          name="faxTo"
          required
          placeholder="(555) 123-4567"
          value={formData.faxTo}
          onChange={handleChange}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-navy/50">
          The number we&apos;re sending to — not your own. US numbers can be entered any way you like.
        </p>
      </div>

      {/* Contact */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fx-name" className={labelClass}>Your name</label>
          <input type="text" id="fx-name" name="name" required value={formData.name} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="fx-email" className={labelClass}>Email</label>
          <input type="email" id="fx-email" name="email" required value={formData.email} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="fx-phone" className={labelClass}>Phone <span className="text-navy/40">(optional)</span></label>
          <input type="tel" id="fx-phone" name="phone" value={formData.phone} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="fx-pages" className={labelClass}>Pages <span className="text-navy/40">(optional)</span></label>
          <input
            type="number"
            id="fx-pages"
            name="pages"
            min="0"
            step="1"
            placeholder="e.g. 3"
            value={formData.pages}
            onChange={handleChange}
            className={inputClass}
          />
        </div>
      </div>

      {/* Live estimate */}
      {quote && (
        <p className="rounded-lg bg-navy/5 px-3 py-2 text-sm text-navy/70">
          Estimated total: <strong className="text-navy">{money(quote.total)}</strong> —{' '}
          {money(FAX_PRICING.outbound.firstPage)} first page,{' '}
          {money(FAX_PRICING.outbound.additionalPage)} each additional. Cover page free.
        </p>
      )}

      {/* Document */}
      <div>
        <label htmlFor="fx-files" className={labelClass}>Document (PDF)</label>
        <input
          type="file"
          id="fx-files"
          ref={fileRef}
          multiple
          accept={PDF_ACCEPT}
          onChange={handleFiles}
          className="mt-1 w-full rounded-lg border border-dashed border-navy/25 bg-white px-3 py-3 text-sm text-navy/70 file:mr-3 file:rounded-md file:border-0 file:bg-blue file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-navy"
        />
        {files.length > 0 && (
          <p className="mt-1 text-xs text-navy/50">
            {files.length} file{files.length === 1 ? '' : 's'} ready.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="fx-notes" className={labelClass}>
          Cover note <span className="text-navy/40">(optional)</span>
        </label>
        <textarea
          id="fx-notes"
          name="notes"
          rows={3}
          placeholder="Attention: … / brief message for the cover page"
          value={formData.notes}
          onChange={handleChange}
          className={inputClass}
        />
      </div>

      {errorMsg && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{errorMsg}</p>}
      {busy && progress && <p className="text-sm text-navy/60">{progress}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-blue px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-navy hover:shadow-lg disabled:opacity-50"
      >
        {status === 'uploading' ? 'Uploading…' : status === 'sending' ? 'Sending…' : 'Send fax request'}
      </button>
      <p className="text-center text-xs text-navy/40">
        We&apos;ll confirm the page count and total before sending. Payment at the counter.
      </p>
    </form>
  );
}
