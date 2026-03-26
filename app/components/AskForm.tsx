"use client";

import { useState } from "react";

export default function AskForm() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: handle form submission (e.g. send to API)
    console.log(formData);
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy transition-all duration-200 focus:border-blue focus:ring-2 focus:ring-blue/20 focus:outline-none";

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
      <button
        type="submit"
        className="w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-navy hover:shadow-lg"
      >
        Send Message
      </button>
    </form>
  );
}