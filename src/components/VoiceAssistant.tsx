"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

type AssistantState = "idle" | "listening" | "thinking" | "speaking";

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

export default function VoiceAssistant() {
  const [state, setState] = useState<AssistantState>("idle");
  const [briefing, setBriefing] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clapEnabled, setClapEnabled] = useState(false);
  const [clapActive, setClapActive] = useState(false); // mic actually listening
  const gotResultRef = useRef(false);

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

  const startListening = useCallback(() => {
    setTranscript(null);
    const recognition = createRecognition();
    if (!recognition) {
      runBriefing();
      return;
    }
    gotResultRef.current = false;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      gotResultRef.current = true;
      const said = event.results[0][0].transcript;
      setTranscript(said);
      runBriefing(said);
    };
    recognition.onerror = () => {
      if (!gotResultRef.current) runBriefing();
    };
    recognition.onend = () => setState((s) => (s === "listening" ? "thinking" : s));
    setState("listening");
    recognition.start();
  }, [runBriefing]);

  // Latest starter for the clap detector to call without re-subscribing the mic.
  const activateRef = useRef<() => void>(() => {});
  useEffect(() => {
    activateRef.current = () => {
      if (state === "idle") startListening();
    };
  }, [state, startListening]);

  const handleMicClick = useCallback(() => {
    if (state !== "idle") {
      window.speechSynthesis?.cancel();
      setState("idle");
      return;
    }
    startListening();
  }, [state, startListening]);

  // -------- Double-clap detection (Web Audio) --------
  useEffect(() => {
    if (!clapEnabled) return;

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    let armed = true;
    let lastClap = 0;
    let lastTrigger = 0;
    const buf = new Float32Array(1024);

    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        setClapActive(true);

        const HIGH = 0.28; // transient peak that counts as a clap
        const LOW = 0.08; // must fall below this to re-arm
        const loop = () => {
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i]);
            if (v > peak) peak = v;
          }
          const now = performance.now();
          if (peak < LOW) armed = true;
          if (armed && peak > HIGH) {
            armed = false; // refractory until amplitude drops again
            if (lastClap && now - lastClap > 120 && now - lastClap < 700 && now - lastTrigger > 1500) {
              lastTrigger = now;
              lastClap = 0;
              activateRef.current();
            } else {
              lastClap = now;
            }
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => {
        if (!cancelled) {
          setError("Mic access denied — can't listen for claps.");
          setClapEnabled(false);
        }
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      setClapActive(false);
    };
  }, [clapEnabled]);

  const dismiss = () => {
    window.speechSynthesis?.cancel();
    setState("idle");
    setBriefing(null);
    setTranscript(null);
    setError(null);
  };

  const label =
    state === "listening"
      ? "Listening…"
      : state === "thinking"
        ? "Thinking…"
        : state === "speaking"
          ? "Speaking — tap to stop"
          : "Ask for your briefing";

  const panelOpen = state !== "idle" || !!briefing || !!error;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex flex-col items-center gap-3">
      {/* The "screen" — briefing panel above the button */}
      {panelOpen && (
        <div className="animate-panel-in glass pointer-events-auto w-[min(92vw,30rem)] rounded-3xl p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-sky-300">
              <span className="relative flex h-2 w-2">
                {state !== "idle" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />}
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
              </span>
              {label}
            </span>
            <button onClick={dismiss} aria-label="Dismiss" className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
          {transcript && <p className="mb-2 text-xs italic text-slate-400">“{transcript}”</p>}
          {error ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : briefing ? (
            <p className="text-sm leading-relaxed text-slate-100">{briefing}</p>
          ) : (
            <p className="text-sm text-slate-400">Your talent-manager briefing will appear here.</p>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="pointer-events-auto flex items-center gap-2.5">
        <button
          onClick={() => setClapEnabled((v) => !v)}
          title="Activate the assistant by clapping twice"
          className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all ${
            clapEnabled ? "border border-sky-400/50 bg-sky-500/15 text-sky-200" : "glass-soft text-slate-300 hover:text-white"
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {clapActive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${clapActive ? "bg-emerald-400" : "bg-slate-500"}`} />
          </span>
          Clap ×2
        </button>

        <button
          onClick={handleMicClick}
          aria-label={label}
          className={`grid h-14 w-14 place-items-center rounded-full shadow-xl transition-all ${
            state === "idle"
              ? "glass text-slate-100 hover:text-white hover:shadow-sky-500/20"
              : "border border-sky-400/50 bg-sky-500/80 text-white shadow-sky-500/30"
          }`}
        >
          {state !== "idle" && <span className="absolute h-14 w-14 animate-ping rounded-full bg-sky-400/30" />}
          <svg className="relative h-6 w-6" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
