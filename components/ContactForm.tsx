"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, website }),
      });

      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send");
      }

      setStatus("sent");
      setName("");
      setEmail("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-line bg-paper p-8 text-center">
        <p className="font-serif text-xl font-medium text-ink">
          Thanks — message sent.
        </p>
        <p className="mt-2 text-[14px] text-ink-2">
          We&apos;ll get back to you within a few days.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      {/* Honeypot — hidden from humans, bots tend to fill every field. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="contact-name"
            className="block font-mono text-[10px] uppercase tracking-[0.12em] text-mute"
          >
            Name (optional)
          </label>
          <input
            id="contact-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="mt-1.5 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink shadow-sm focus:border-ink-2 focus:outline-none focus:ring-1 focus:ring-ink-2"
          />
        </div>
        <div>
          <label
            htmlFor="contact-email"
            className="block font-mono text-[10px] uppercase tracking-[0.12em] text-mute"
          >
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            className="mt-1.5 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink shadow-sm focus:border-ink-2 focus:outline-none focus:ring-1 focus:ring-ink-2"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="contact-message"
          className="block font-mono text-[10px] uppercase tracking-[0.12em] text-mute"
        >
          Message
        </label>
        <textarea
          id="contact-message"
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={5000}
          rows={5}
          className="mt-1.5 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink shadow-sm focus:border-ink-2 focus:outline-none focus:ring-1 focus:ring-ink-2"
        />
      </div>

      {status === "error" && (
        <p className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          {errorMsg}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[12px] text-mute">
          Replies go straight to our inbox.
        </p>
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "sending" ? "Sending..." : "Send message"}
        </button>
      </div>
    </form>
  );
}
