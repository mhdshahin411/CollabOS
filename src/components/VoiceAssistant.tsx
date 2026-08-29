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

export default function VoiceAssistant({ name }: { name?: string }) {
  const [state, setState] = useState<AssistantState>("idle");
  const [briefing, setBriefing] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clapEnabled, setClapEnabled] = useState(false);
  const [clapActive, setClapActive] = useState(false); // mic actually listening
  const startListeningRef = useRef<() => void>(() => {});

  useEffect(() => {
    return () => window.speechSynthesis?.cancel();
  }, []);

  // Speak `text`, then return to idle. (No auto-listen — that caused the mic to
  // re-trigger on the assistant's own voice.)
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

  // No `query` -> a greeting + summary (the Briefing button).
  // With `query` -> an answer to the spoken question (the mic).
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
          body: JSON.stringify({ query, name, markAsRead: false }),
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
    [speak, name],
  );

  // Listen for a spoken question, then answer it.
  const startListening = useCallback(() => {
    setBriefing(null);
    setTranscript(null);
    const recognition = createRecognition();
    if (!recognition) {
      // No speech recognition available — fall back to the spoken briefing.
      runBriefing();
      return;
    }
    let handled = false;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      handled = true;
      const said = event.results[0][0].transcript;
      setTranscript(said);
      runBriefing(said);
    };
    recognition.onerror = () => {
      if (!handled) {
        handled = true;
        setState("idle");
      }
    };
    recognition.onend = () => {
      if (!handled) {
        handled = true;
        setState("idle");
      }
    };
    setState("listening");
    try {
      recognition.start();
    } catch {
      if (!handled) {
        handled = true;
        setState("idle");
      }
    }
  }, [runBriefing]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // Mic button: if busy, stop; otherwise start listening for a question.
  const handleMicClick = useCallback(() => {
    if (state !== "idle") {
      window.speechSynthesis?.cancel();
      setState("idle");
      return;
    }
    startListening();
  }, [state, startListening]);

  // Briefing button: greet by name + summarize new pitches.
  const handleBriefingClick = useCallback(() => {
    if (state !== "idle") {
      window.speechSynthesis?.cancel();
      setState("idle");
      return;
    }
    runBriefing();
  }, [state, runBriefing]);

  // -------- Double-clap detection (Web Audio) --------
  // A double-clap opens the mic to ask a question. Only holds the mic while
  // enabled AND idle, so it releases the moment the assistant becomes active
  // (frees the device for SpeechRecognition, stops TTS loopback).
  useEffect(() => {
    if (!clapEnabled || state !== "idle") return;

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    let triggered = false;
    let armed = true;
    let lastClap = 0;
    let lastTrigger = 0;
    const buf = new Float32Array(1024);

    const HIGH = 0.28;
    const LOW = 0.08;
    const MIN_GAP = 60;
    const MAX_GAP = 700;
    const COOLDOWN = 1500;

    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        setClapActive(true);

        const loop = () => {
          if (triggered) return;
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i]);
            if (v > peak) peak = v;
          }
          const now = performance.now();
          if (peak < LOW) armed = true;
          if (armed && peak > HIGH) {
            armed = false;
            const dt = lastClap ? now - lastClap : Infinity;
            if (dt >= MIN_GAP && dt <= MAX_GAP && now - lastTrigger > COOLDOWN) {
              lastTrigger = now;
              lastClap = 0;
              triggered = true;
              startListeningRef.current(); // clap -> ask a question
              return;
            }
            if (dt >= MIN_GAP) {
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
  }, [clapEnabled, state]);

  const dismiss = () => {
    window.speechSynthesis?.cancel();
    setState("idle");
    setBriefing(null);
    setTranscript(null);
    setError(null);
  };

  const label =
    state === "listening"
      ? "Listening — ask your question…"
      : state === "thinking"
        ? "Thinking…"
        : state === "speaking"
          ? "Speaking — tap to stop"
          : "Voice assistant";

  const panelOpen = state !== "idle" || !!briefing || !!error;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex flex-col items-center gap-3">
      {/* The "screen" — panel above the buttons */}
      {panelOpen && (
        <div className="animate-panel-in panel-solid pointer-events-auto w-[min(92vw,30rem)] rounded-3xl p-4">
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
          ) : state === "listening" ? (
            <p className="text-sm text-slate-400">Go ahead — ask about your deals.</p>
          ) : (
            <p className="text-sm text-slate-400">One moment…</p>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="pointer-events-auto flex items-center gap-2.5">
        <button
          onClick={() => setClapEnabled((v) => !v)}
          title="Double-clap to open the mic"
          className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all ${
            clapEnabled ? "border border-sky-400/50 bg-sky-500/15 text-sky-200" : "bg-slate-800 text-slate-300 hover:text-white"
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {clapActive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${clapActive ? "bg-emerald-400" : "bg-slate-500"}`} />
          </span>
          Clap ×2
        </button>

        {/* Briefing: greet by name + summarize */}
        <button
          onClick={handleBriefingClick}
          title="Hear your briefing"
          className="flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition-all hover:text-white"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <path d="M4 5h16v10H7l-3 3V5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          Briefing
        </button>

        {/* Mic: ask a question */}
        <button
          onClick={handleMicClick}
          aria-label={state === "listening" ? "Listening" : "Ask a question"}
          title="Ask a question"
          className={`relative grid h-14 w-14 place-items-center rounded-full shadow-xl transition-all ${
            state === "idle"
              ? "bg-slate-800 text-slate-100 hover:text-white hover:shadow-sky-500/20"
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
