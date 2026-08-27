"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

type BriefingState = "idle" | "listening" | "thinking" | "speaking";

/** Web Speech API isn't in the TS DOM lib yet, so resolve it dynamically. */
function createRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export default function VoiceBriefing() {
  const [state, setState] = useState<BriefingState>("idle");
  const [briefing, setBriefing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gotResultRef = useRef(false);

  // Stop any speech when the component unmounts
  useEffect(() => {
    return () => window.speechSynthesis?.cancel();
  }, []);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) {
      setState("idle");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.onend = () => setState("idle");
    utterance.onerror = () => setState("idle");
    setState("speaking");
    window.speechSynthesis.speak(utterance);
  }, []);

  const runBriefing = useCallback(
    async (query?: string) => {
      setState("thinking");
      setError(null);
      try {
        const supabase = getSupabaseBrowser();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setError("Sign in to hear your briefing.");
          setState("idle");
          return;
        }

        const res = await fetch("/api/voice-summary", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error(`Briefing request failed (${res.status})`);

        const data: { briefing: string } = await res.json();
        setBriefing(data.briefing);
        speak(data.briefing);
      } catch (err) {
        console.error(err);
        setError("Couldn't fetch your briefing. Try again.");
        setState("idle");
      }
    },
    [speak],
  );

  const handleMicClick = useCallback(() => {
    // Any click while busy stops everything
    if (state !== "idle") {
      window.speechSynthesis?.cancel();
      setState("idle");
      return;
    }

    const recognition = createRecognition();
    if (!recognition) {
      // No speech recognition support -> run the default daily briefing
      runBriefing();
      return;
    }

    gotResultRef.current = false;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      gotResultRef.current = true;
      runBriefing(event.results[0][0].transcript);
    };
    recognition.onerror = () => {
      if (!gotResultRef.current) runBriefing(); // fall back to default briefing
    };
    recognition.onend = () => {
      setState((s) => (s === "listening" ? "thinking" : s));
    };
    setState("listening");
    recognition.start();
  }, [state, runBriefing]);

  const label =
    state === "listening"
      ? "Listening…"
      : state === "thinking"
        ? "Thinking…"
        : state === "speaking"
          ? "Speaking — tap to stop"
          : "Daily briefing";

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleMicClick}
        className={`flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
          state === "idle"
            ? "glass-soft text-slate-200 hover:text-white"
            : "border border-sky-400/50 bg-sky-500/15 text-sky-200"
        }`}
      >
        <span className="relative flex h-2.5 w-2.5">
          {state !== "idle" && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              state === "idle" ? "bg-slate-500" : "bg-sky-400"
            }`}
          />
        </span>
        {label}
      </button>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      {briefing && !error && (
        <p className="max-w-sm text-right text-xs leading-relaxed text-slate-500">{briefing}</p>
      )}
    </div>
  );
}
