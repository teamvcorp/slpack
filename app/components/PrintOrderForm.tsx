"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { computePrintPrice, money, PRINT_PRICING, type PrintColor } from "@/lib/printPricing";

type Status = "idle" | "uploading" | "sending" | "sent" | "error";

const ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALLOWED_EXT = [".pdf", ".doc", ".docx"];

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  pages: "",
  copies: "1",
  notes: "",
  recipientEmail: "",
  company: "", // honeypot — must stay empty
};

export default function PrintOrderForm() {
  const [formData, setFormData] = useState({ ...EMPTY });
  const [color, setColor] = useState<PrintColor>("bw");
  const [collated, setCollated] = useState(false);
  const [stapled, setStapled] = useState(false);
  const [sendToRecipient, setSendToRecipient] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pagesNum = Number(formData.pages) || 0;
  const copiesNum = Math.max(1, Number(formData.copies) || 1);
  const quote = computePrintPrice({ pages: pagesNum, copies: copiesNum, color });
  const busy = status === "uploading" || status === "sending";

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setErrorMsg(null);
    const bad = picked.find(
      (f) => !ALLOWED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (bad) {
      setErrorMsg(`"${bad.name}" isn't a PDF or Word document.`);
      return;
    }
    setFiles(picked);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (files.length === 0) {
      setErrorMsg("Please attach at least one PDF or Word document.");
      return;
    }
    if (sendToRecipient && !formData.recipientEmail.trim()) {
      setErrorMsg("Enter the recipient email, or uncheck “email finished files to someone”.");
      return;
    }

    try {
      // 1. Upload each document straight to Vercel Blob (no request-size limit).
      setStatus("uploading");
      const uploaded: { name: string; url: string; size: number }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/print-order/upload",
          multipart: true, // chunked upload — reliable for large files
        });
        uploaded.push({ name: file.name, url: blob.url, size: file.size });
      }

      // 2. Send the order (options + estimate + blob links) to the shop.
      setStatus("sending");
      setProgress("Sending your order…");
      const res = await fetch("/api/print-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          color,
          collated,
          stapled,
          sendToRecipient,
          pages: pagesNum,
          copies: copiesNum,
          files: uploaded,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Something went wrong (${res.status}).`);
      }

      setStatus("sent");
      setFormData({ ...EMPTY });
      setColor("bw");
      setCollated(false);
      setStapled(false);
      setSendToRecipient(false);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send your order.");
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
        <p className="text-base font-semibold text-green-800">Order received — thank you!</p>
        <p className="mt-1 text-sm text-green-700">
          We&apos;ve got your documents and sent a confirmation to your email. We&apos;ll have your
          prints ready shortly.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-medium text-blue hover:underline"
        >
          Send another order
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5 text-left">
      {/* Contact */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="po-name" className={labelClass}>Name</label>
          <input type="text" id="po-name" name="name" required value={formData.name} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="po-email" className={labelClass}>Email</label>
          <input type="email" id="po-email" name="email" required value={formData.email} onChange={handleChange} className={inputClass} />
        </div>
        <div>
          <label htmlFor="po-phone" className={labelClass}>Phone <span className="text-navy/40">(optional)</span></label>
          <input type="tel" id="po-phone" name="phone" value={formData.phone} onChange={handleChange} className={inputClass} />
        </div>
      </div>

      {/* Print options */}
      <div className="rounded-xl border border-navy/10 bg-cream/50 p-4">
        <p className="text-sm font-semibold text-navy">Print options</p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <span className={labelClass}>Color</span>
            <div className="mt-1 flex gap-2">
              {(["bw", "color"] as PrintColor[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    color === c
                      ? "border-blue bg-blue text-white"
                      : "border-navy/20 bg-white text-navy/70 hover:bg-cream"
                  }`}
                >
                  {c === "bw" ? "Black & white" : "Color"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="po-pages" className={labelClass}>Pages <span className="text-navy/40">(per set)</span></label>
              <input type="number" min="0" inputMode="numeric" id="po-pages" name="pages" placeholder="e.g. 12" value={formData.pages} onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label htmlFor="po-copies" className={labelClass}>Copies</label>
              <input type="number" min="1" inputMode="numeric" id="po-copies" name="copies" value={formData.copies} onChange={handleChange} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-navy/80">
            <input type="checkbox" checked={collated} onChange={(e) => setCollated(e.target.checked)} className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue" />
            Collated
          </label>
          <label className="flex items-center gap-2 text-sm text-navy/80">
            <input type="checkbox" checked={stapled} onChange={(e) => setStapled(e.target.checked)} className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue" />
            Stapled
          </label>
        </div>

        {/* Live estimate */}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold text-navy">Estimated price</span>
            {quote.totalPages > 0 && (
              <p className="text-xs text-navy/50">
                {quote.totalPages} printed page{quote.totalPages === 1 ? "" : "s"} · {quote.tierCount} @ {(quote.tierRate * 100).toFixed(0)}¢
                {quote.overCount > 0 ? ` + ${quote.overCount} @ ${(quote.overRate * 100).toFixed(0)}¢` : ""}
              </p>
            )}
          </div>
          <span className="text-xl font-extrabold text-navy">
            {quote.totalPages > 0 ? money(quote.total) : "—"}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-navy/40">
          Estimate only — final price is confirmed at the counter. {PRINT_PRICING.bw.tierRate * 100}¢/page B&amp;W
          (then {PRINT_PRICING.bw.overRate * 100}¢ after {PRINT_PRICING.bw.tierPages}); {PRINT_PRICING.color.tierRate * 100}¢/page color
          (then {PRINT_PRICING.color.overRate * 100}¢ after {PRINT_PRICING.color.tierPages}).
        </p>
      </div>

      {/* Files */}
      <div>
        <label htmlFor="po-files" className={labelClass}>
          Documents <span className="text-navy/40">(PDF or Word — any size, multiple allowed)</span>
        </label>
        <input
          ref={fileRef}
          type="file"
          id="po-files"
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

      {/* Email finished files to someone */}
      <div>
        <label className="flex items-center gap-2 text-sm text-navy/80">
          <input type="checkbox" checked={sendToRecipient} onChange={(e) => setSendToRecipient(e.target.checked)} className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue" />
          Email the finished files to someone
        </label>
        {sendToRecipient && (
          <input
            type="email"
            name="recipientEmail"
            placeholder="recipient@example.com"
            value={formData.recipientEmail}
            onChange={handleChange}
            className={`${inputClass} mt-2`}
          />
        )}
      </div>

      <div>
        <label htmlFor="po-notes" className={labelClass}>Instructions <span className="text-navy/40">(optional)</span></label>
        <textarea id="po-notes" name="notes" rows={3} placeholder="Paper size, double-sided, pickup vs. hold, deadline…" value={formData.notes} onChange={handleChange} className={inputClass} />
      </div>

      {/* Honeypot */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="po-company">Company</label>
        <input type="text" id="po-company" name="company" tabIndex={-1} autoComplete="off" value={formData.company} onChange={handleChange} />
      </div>

      {busy && progress && <p className="text-sm text-navy/60">{progress}</p>}
      {status === "error" && errorMsg && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-navy hover:shadow-lg disabled:opacity-60"
      >
        {status === "uploading" ? "Uploading…" : status === "sending" ? "Sending…" : "Send my documents to print"}
      </button>
    </form>
  );
}
