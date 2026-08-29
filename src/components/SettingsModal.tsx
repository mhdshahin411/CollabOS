"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export interface ChannelAccounts {
  gmail?: string | null;
  instagram?: string | null;
  whatsapp?: string | null;
}

// Where the real Gmail OAuth connection is reconnected (Google sign-in lives here).
const N8N_GMAIL_WORKFLOW = "https://shain411.app.n8n.cloud/workflow/GJPRtpjfB2rleTpR";

const FIELDS: { key: keyof ChannelAccounts; label: string; placeholder: string }[] = [
  { key: "gmail", label: "Gmail address", placeholder: "you@gmail.com" },
  { key: "instagram", label: "Instagram handle", placeholder: "@yourhandle" },
  { key: "whatsapp", label: "WhatsApp number", placeholder: "+1 555 123 4567" },
];

export default function SettingsModal({
  accounts,
  onClose,
}: {
  accounts: ChannelAccounts;
  onClose: () => void;
}) {
  const [values, setValues] = useState<ChannelAccounts>({
    gmail: accounts.gmail ?? "",
    instagram: accounts.instagram ?? "",
    whatsapp: accounts.whatsapp ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError(null);
    const channel_accounts: ChannelAccounts = {
      gmail: values.gmail?.trim() || null,
      instagram: values.instagram?.trim() || null,
      whatsapp: values.whatsapp?.trim() || null,
    };
    const { error: err } = await getSupabaseBrowser().auth.updateUser({
      data: { channel_accounts },
    });
    if (err) {
      console.error("Failed to save settings:", err);
      setError("Couldn't save. Try again.");
      setSaving(false);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="animate-panel-in panel-solid relative w-full max-w-md rounded-3xl p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="font-display text-2xl text-white">Connected accounts</h2>
            <p className="mt-1 text-xs text-slate-400">The account labels shown on your sidebar per channel.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">{f.label}</label>
              <input
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-sky-400/60"
              />
            </div>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

        {/* Reconnect note — the real inbox connection lives in n8n. */}
        <div className="mt-5 rounded-2xl bg-slate-800 p-3.5 text-xs leading-relaxed text-slate-400">
          These are display labels. To change the <span className="text-slate-200">actual inbox</span> that feeds your
          deals, reconnect Gmail in n8n (Google sign-in happens there) →{" "}
          <a
            href={N8N_GMAIL_WORKFLOW}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-sky-300 underline hover:text-sky-200"
          >
            Reconnect in n8n
          </a>
        </div>

        <div className="mt-5 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-white/20 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
