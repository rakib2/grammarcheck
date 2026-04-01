"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import GrammarCorrection from "@/components/GrammarCorrection";
import RuleCard from "@/components/RuleCard";
import ScoreRing from "@/components/ScoreRing";
import SpeechButton from "@/components/SpeechButton";
import SpeakButton from "@/components/SpeakButton";
import { useSpeech } from "@/lib/useSpeech";
import { useVoiceState } from "@/lib/useVoiceState";
import { Token, LearnerModel, ConversationState, CefrLevel, CorrectionLevel } from "@/types";

// ── Helpers ──

/** Escape HTML entities, then apply safe markdown-like transforms (bold + newlines). */
function safeMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}

// ── Types for API responses ──

interface Correction {
  original: string;
  correction: string;
  level: CorrectionLevel;
}

interface RuleCardData {
  structureName: string;
  rule: string;
  l1Comparison: string | null;
  example: string;
}

interface LessonSuggestion {
  message: string;
  lessonId: string;
}

interface ConverseTurnResult {
  responseText: string;
  corrections: Correction[];
  ruleCard: RuleCardData | null;
  nextPrompt: string;
  score: number;
  detectedLevel: CefrLevel;
  tokens: Token[];
  updatedModel: LearnerModel;
  updatedState: ConversationState;
  lessonSuggestion: LessonSuggestion | null;
}

interface Turn {
  sentence: string;
  result: ConverseTurnResult;
}

const LEVEL_LABELS: Record<CefrLevel, string> = {
  A1: "Beginner", A2: "Elementary", B1: "Intermediate",
  B2: "Upper Intermediate", C1: "Advanced", C2: "Mastery",
};

const STORAGE_KEY = "grammarcoach_learner_model";
const VOICE_MODE_KEY = "grammarcoach_voice_mode";
const VOICE_CHOICE_KEY = "grammarcoach_voice_choice";

type TTSVoice = "nova" | "shimmer" | "alloy" | "echo" | "fable" | "onyx";
const VOICE_OPTIONS: { id: TTSVoice; label: string }[] = [
  { id: "nova", label: "Nova (warm)" },
  { id: "shimmer", label: "Shimmer (soft)" },
  { id: "alloy", label: "Alloy (neutral)" },
  { id: "echo", label: "Echo (calm)" },
  { id: "fable", label: "Fable (expressive)" },
  { id: "onyx", label: "Onyx (deep)" },
];

function loadModel(): LearnerModel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveModel(model: LearnerModel) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
}

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [learnerModel, setLearnerModel] = useState<LearnerModel | null>(null);
  const [convState, setConvState] = useState<ConversationState | null>(null);
  const [opener, setOpener] = useState<string | null>(null);
  const [langInput, setLangInput] = useState("");
  const [needsLanguage, setNeedsLanguage] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceChoice, setVoiceChoice] = useState<TTSVoice>("nova");
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSentence, setStreamingSentence] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingPromptRef = useRef<string | null>(null);

  // Voice state machine — coordinates mic and TTS
  const voice = useVoiceState({ autoListen: voiceMode });

  // Speech synthesis — uses selected voice, notifies voice state on natural end
  const { speak, stop, speaking, supported: ttsSupported } = useSpeech({
    voice: voiceChoice,
    onEnd: voice.finishSpeaking,
  });

  // Load voice preferences
  useEffect(() => {
    if (typeof window !== "undefined") {
      setVoiceMode(localStorage.getItem(VOICE_MODE_KEY) === "true");
      const saved = localStorage.getItem(VOICE_CHOICE_KEY) as TTSVoice | null;
      if (saved) setVoiceChoice(saved);
    }
  }, []);

  // ── Load or initialize learner model ──
  useEffect(() => {
    const saved = loadModel();
    if (saved) {
      setLearnerModel(saved);
      setNeedsLanguage(false);
      initSession(saved.nativeLanguage, saved);
    } else {
      setNeedsLanguage(true);
      setInitializing(false);
    }
  }, []);

  const initSession = useCallback(async (lang: string, existingModel?: LearnerModel) => {
    try {
      const res = await fetch(`/api/converse?action=init&lang=${encodeURIComponent(lang)}`);
      const data = await res.json();

      if (existingModel) {
        setLearnerModel(existingModel);
        setConvState(data.conversationState);
        const { getSessionOpener } = await import("@/lib/conversationEngine");
        setOpener(getSessionOpener(existingModel));
      } else {
        setLearnerModel(data.learnerModel);
        setConvState(data.conversationState);
        setOpener(data.opener);
        saveModel(data.learnerModel);
      }
    } catch {
      const { createLearnerModel, createConversationState, getSessionOpener } = await import("@/lib/conversationEngine");
      const model = existingModel ?? createLearnerModel(lang);
      setLearnerModel(model);
      setConvState(createConversationState());
      setOpener(getSessionOpener(model));
      if (!existingModel) saveModel(model);
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, loading, streamingText]);

  useEffect(() => {
    if (!loading && !needsLanguage && !initializing) {
      inputRef.current?.focus();
    }
  }, [turns, loading, needsLanguage, initializing]);

  // When TTS finishes, speak queued nextPrompt or reset
  useEffect(() => {
    if (!speaking && pendingPromptRef.current && voiceMode) {
      const prompt = pendingPromptRef.current;
      pendingPromptRef.current = null;
      // Small pause before the follow-up prompt
      const timer = setTimeout(() => {
        voice.startSpeaking();
        speak(prompt);
      }, 300);
      return () => clearTimeout(timer);
    }
    if (!speaking) setSpeakingIdx(null);
  }, [speaking]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Speech input handler — auto-submit in voice mode ──
  function handleSpeechResult(text: string) {
    if (voiceMode && text.trim() && learnerModel && convState) {
      // Transition: RECORDING → PROCESSING
      voice.startProcessing();
      setInput("");
      submitSentence(text.trim());
    } else {
      setInput(text);
    }
  }

  // Notify voice state when mic starts/stops
  function handleListeningChange(listening: boolean) {
    if (listening) {
      // Stop any playing TTS before recording
      stop();
      voice.startRecording();
    } else if (voice.state === "RECORDING" && !voiceMode) {
      // In non-voice mode, stopping mic goes back to IDLE
      voice.stopRecording();
    }
  }

  async function submitSentence(text: string) {
    if (!text || loading || !learnerModel || !convState) return;
    setLoading(true);
    setStreamingText("");
    setStreamingSentence(text);

    try {
      const res = await fetch("/api/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: text,
          learnerModel,
          conversationState: convState,
        }),
      });

      if (!res.ok) throw new Error("API error");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            if (event.type === "token") {
              setStreamingText((prev) => prev + event.text);
            } else if (event.type === "coachDone") {
              setStreamingText(event.text);
              // Start TTS — voice state gates this (blocked during RECORDING)
              if (voiceMode && voice.canSpeak) {
                voice.startSpeaking();
                // Combine coach message + nextPrompt into one TTS call
                // nextPrompt comes later in the "analysis" event, so just speak coach text now
                speak(event.text);
              }
            } else if (event.type === "analysis") {
              const result: ConverseTurnResult = event.data;
              setTurns((prev) => [...prev, { sentence: text, result }]);
              setLearnerModel(result.updatedModel);
              setConvState(result.updatedState);
              saveModel(result.updatedModel);
              setStreamingText("");
              setStreamingSentence("");
              // Queue nextPrompt to speak after coach message TTS finishes
              if (voiceMode && result.nextPrompt) {
                pendingPromptRef.current = result.nextPrompt;
              }
            } else if (event.type === "error") {
              console.error("Stream error:", event.message);
              setInput(text);
              setStreamingText("");
              setStreamingSentence("");
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      setInput(text);
      setStreamingText("");
      setStreamingSentence("");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await submitSentence(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function toggleVoiceMode() {
    const next = !voiceMode;
    setVoiceMode(next);
    localStorage.setItem(VOICE_MODE_KEY, String(next));
    if (!next) {
      stop();
      voice.reset();
    }
  }

  function handleSpeak(text: string, idx: number) {
    if (speakingIdx === idx) {
      stop();
    } else {
      setSpeakingIdx(idx);
      speak(text);
    }
  }

  function handleLanguageSubmit() {
    if (!langInput.trim()) return;
    setNeedsLanguage(false);
    initSession(langInput.trim());
  }

  function handleLangKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleLanguageSubmit();
    }
  }

  function changeCoachLanguage(lang: string) {
    if (!learnerModel) return;
    const updated = { ...learnerModel, coachLanguage: lang, updatedAt: new Date().toISOString() };
    setLearnerModel(updated);
    saveModel(updated);
    setShowLangMenu(false);
  }

  function startNewSession() {
    setTurns([]);
    stop();
    if (learnerModel) {
      const updatedModel = { ...learnerModel, sessionCount: learnerModel.sessionCount + 1 };
      setLearnerModel(updatedModel);
      saveModel(updatedModel);
      initSession(updatedModel.nativeLanguage, updatedModel);
    }
  }

  // ── Computed values ──
  const latestLevel = turns.length > 0
    ? turns[turns.length - 1].result.detectedLevel
    : learnerModel?.detectedLevel ?? null;
  const totalStructures = learnerModel?.structures.length ?? 0;
  const weakStructures = learnerModel?.structures.filter((s) => s.mastery < 0.5).length ?? 0;

  // ── Step 1: Native language ──
  if (needsLanguage) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8 text-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">GrammarCoach</h1>
            <p className="mt-2 text-base text-gray-500">Learn German through conversation</p>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">What&apos;s your native language?</p>
            <div className="flex gap-3">
              <input
                value={langInput}
                onChange={(e) => setLangInput(e.target.value)}
                onKeyDown={handleLangKeyDown}
                placeholder="e.g. English, Turkish, Bengali..."
                autoFocus
                className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
              />
              <button
                onClick={handleLanguageSubmit}
                disabled={!langInput.trim()}
                className="rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
              >
                Go
              </button>
            </div>
          </div>
          <button onClick={() => router.push("/progress")} className="text-xs text-gray-400 hover:text-gray-600">
            Deep Practice Mode &rarr;
          </button>
        </div>
      </div>
    );
  }

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Starting session&hellip;</p>
      </div>
    );
  }

  // ── Main conversation flow ──
  const lastResult = turns.length > 0 ? turns[turns.length - 1].result : null;
  const ruleTokens: Token[] = lastResult
    ? lastResult.tokens.filter((t) => (t.status === "wrong" || t.status === "warn") && (t.correction || t.rule))
    : [];

  // ── Mistake highlights for sidebar ──
  const errorPatterns = learnerModel?.errorPatterns ?? [];
  const topMistakes = [...errorPatterns].sort((a, b) => b.count - a.count).slice(0, 5);
  const weakList = learnerModel?.structures.filter((s) => s.mastery < 0.5).sort((a, b) => a.mastery - b.mastery).slice(0, 3) ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-gray-900">GrammarCoach</span>
          {latestLevel && (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">
              {latestLevel} &middot; {LEVEL_LABELS[latestLevel]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Coach language selector */}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-200 transition-colors"
              title="Change coach response language"
            >
              {learnerModel?.coachLanguage ?? "English"}
            </button>
            {showLangMenu && (
              <div className="absolute right-0 top-full mt-1 z-10 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {["English", "Bengali", "German", "Turkish", "Hindi", "Spanish"].map((lang) => (
                  <button
                    key={lang}
                    onClick={() => changeCoachLanguage(lang)}
                    className={`block w-full px-4 py-1.5 text-left text-xs transition-colors hover:bg-gray-50 ${
                      learnerModel?.coachLanguage === lang ? "font-medium text-gray-900" : "text-gray-600"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Voice controls */}
          {ttsSupported && (
            <div className="flex items-center gap-1">
              <button
                onClick={toggleVoiceMode}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  voiceMode
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
                title={voiceMode ? "Voice mode ON — coach speaks, mic auto-submits" : "Turn on voice mode"}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {voiceMode && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
                </svg>
                Voice {voiceMode ? "On" : "Off"}
              </button>
              {/* Voice picker */}
              <div className="relative">
                <button
                  onClick={() => setShowVoiceMenu(!showVoiceMenu)}
                  className="rounded-lg bg-gray-100 px-2 py-1.5 text-[10px] text-gray-400 hover:bg-gray-200 transition-colors"
                  title="Change voice"
                >
                  {voiceChoice}
                </button>
                {showVoiceMenu && (
                  <div className="absolute right-0 top-full mt-1 z-10 rounded-lg border border-gray-200 bg-white py-1 shadow-lg min-w-[140px]">
                    {VOICE_OPTIONS.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setVoiceChoice(v.id);
                          localStorage.setItem(VOICE_CHOICE_KEY, v.id);
                          setShowVoiceMenu(false);
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-50 ${
                          voiceChoice === v.id ? "font-medium text-gray-900" : "text-gray-600"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <button onClick={startNewSession} className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
            New Session
          </button>
          <button onClick={() => router.push("/progress")} className="text-xs text-gray-400 hover:text-gray-600">
            Overview &rarr;
          </button>
        </div>
      </header>

      {/* Voice mode banner */}
      {voiceMode && (
        <div className="border-b border-gray-200 bg-gray-900 px-6 py-2 text-center text-xs text-white">
          Voice mode — Coach speaks responses. Tap mic to talk, auto-submits when you stop.
        </div>
      )}

      {/* Main area: conversation + sidebar */}
      <div className="flex flex-1 overflow-hidden">

      {/* Conversation column */}
      <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-lg space-y-5">
          {/* Session opener */}
          {opener && (
            <div className="fade-in-up flex items-start gap-2">
              <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                {opener}
              </div>
              {ttsSupported && (
                <SpeakButton
                  onClick={() => handleSpeak(opener, -1)}
                  speaking={speakingIdx === -1 && speaking}
                />
              )}
            </div>
          )}

          {/* Turns */}
          {turns.map((turn, i) => (
            <div key={i} className="fade-in-up space-y-3">
              {/* User sentence */}
              <div className="flex justify-end">
                <div className="max-w-sm rounded-2xl rounded-br-md bg-gray-900 px-4 py-3 text-sm text-white">
                  {turn.sentence}
                </div>
              </div>

              {/* Coach response */}
              <div className="space-y-3">
                {/* Score + response text + speak button */}
                <div className="flex gap-3">
                  <div className="score-pop">
                    <ScoreRing score={turn.result.score} size={44} />
                  </div>
                  <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                    <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                      __html: safeMarkdown(turn.result.responseText)
                    }} />
                  </div>
                  {ttsSupported && (
                    <SpeakButton
                      onClick={() => handleSpeak(
                        turn.result.responseText + ". " + turn.result.nextPrompt,
                        i
                      )}
                      speaking={speakingIdx === i && speaking}
                    />
                  )}
                </div>

                {/* Corrections */}
                {turn.result.corrections.length > 0 && (
                  <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
                    <GrammarCorrection
                      tokens={turn.result.tokens}
                      score={turn.result.score}
                      errorTypes={turn.result.corrections.map((c) => c.level)}
                    />
                  </div>
                )}

                {/* Rule card (explicit level, latest turn) */}
                {i === turns.length - 1 && turn.result.ruleCard && (
                  <div className="rule-card-enter rounded-xl border border-gray-200 bg-white p-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      {turn.result.ruleCard.structureName}
                    </p>
                    <p className="mt-2 text-sm text-gray-700">{turn.result.ruleCard.rule}</p>
                    {turn.result.ruleCard.l1Comparison && (
                      <p className="mt-2 text-sm text-gray-500 italic">
                        {turn.result.ruleCard.l1Comparison}
                      </p>
                    )}
                    <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm font-mono text-gray-600">
                      {turn.result.ruleCard.example}
                    </p>
                  </div>
                )}

                {/* Token-level rule cards (latest turn, no explicit card) */}
                {i === turns.length - 1 && !turn.result.ruleCard && ruleTokens.length > 0 && (
                  <div className="space-y-2">
                    {ruleTokens.map((token, j) => (
                      <RuleCard key={j} token={token} index={j} />
                    ))}
                  </div>
                )}

                {/* Lesson suggestion */}
                {i === turns.length - 1 && turn.result.lessonSuggestion && (
                  <button
                    onClick={() => router.push(`/chat?lesson=${turn.result.lessonSuggestion!.lessonId}`)}
                    className="fade-in-up flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50"
                  >
                    <span className="text-sm text-gray-400">&#8594;</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500">{turn.result.lessonSuggestion.message}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium text-gray-500">
                      Practice
                    </span>
                  </button>
                )}

                {/* Next prompt */}
                {i === turns.length - 1 && turn.result.nextPrompt && (
                  <div className="fade-in-up flex items-start gap-2">
                    <div className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
                      <p className="text-sm text-gray-600">{turn.result.nextPrompt}</p>
                    </div>
                    {ttsSupported && (
                      <SpeakButton
                        onClick={() => handleSpeak(turn.result.nextPrompt, i + 1000)}
                        speaking={speakingIdx === i + 1000 && speaking}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming response */}
          {loading && streamingSentence && (
            <div className="fade-in-up space-y-3">
              {/* User sentence (already sent) */}
              <div className="flex justify-end">
                <div className="max-w-sm rounded-2xl rounded-br-md bg-gray-900 px-4 py-3 text-sm text-white">
                  {streamingSentence}
                </div>
              </div>
              {/* Coach streaming bubble */}
              {streamingText ? (
                <div className="flex gap-3">
                  <div className="w-[44px]" /> {/* score placeholder */}
                  <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                    <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                      __html: safeMarkdown(streamingText)
                    }} />
                    <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-400 ring-1 ring-gray-100">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Loading (only when no streaming text yet and no sentence) */}
          {loading && !streamingSentence && (
            <div className="fade-in-up">
              <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-400 ring-1 ring-gray-100">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  <span className="ml-2">Thinking&hellip;</span>
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar — inside conversation column so it aligns */}
      <div className="border-t border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-lg gap-2">
          <SpeechButton
            onResult={handleSpeechResult}
            onInterim={(text) => { if (!voiceMode) setInput(text); }}
            onListeningChange={handleListeningChange}
            disabled={loading || !voice.canRecord}
            voiceMode={voiceMode}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={voiceMode ? "Tap the mic to speak, or type..." : "Write a German sentence..."}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || loading}
            className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
      </div>{/* end conversation column */}

      {/* Right sidebar — compact mistake highlights */}
      {(topMistakes.length > 0 || weakList.length > 0) && (
        <aside className="hidden lg:flex w-56 shrink-0 flex-col border-l border-gray-200 bg-white overflow-y-auto">
          <div className="px-4 py-4 space-y-4">
            {/* Weak areas */}
            {weakList.length > 0 && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-2">Focus areas</p>
                <div className="space-y-1.5">
                  {weakList.map((s) => (
                    <div key={s.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-600 truncate">{s.name}</span>
                        <span className="text-[10px] text-gray-400">{Math.round(s.mastery * 100)}%</span>
                      </div>
                      <div className="h-0.5 w-full rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-gray-400 transition-all"
                          style={{ width: `${Math.max(Math.round(s.mastery * 100), 2)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top mistakes */}
            {topMistakes.length > 0 && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-2">Frequent mistakes</p>
                <div className="space-y-2">
                  {topMistakes.map((err) => (
                    <div key={err.id} className="text-[11px]">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-red-500 line-through">{err.example}</span>
                        <span className="text-gray-300">&rarr;</span>
                        <span className="text-green-600">{err.correction}</span>
                      </div>
                      <p className="text-[10px] text-gray-400">{err.count}x</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Link to full overview */}
            <button
              onClick={() => router.push("/progress")}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Full overview &rarr;
            </button>
          </div>
        </aside>
      )}

      </div>{/* end main flex area */}
    </div>
  );
}
