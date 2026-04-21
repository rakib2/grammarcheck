"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import GrammarCorrection from "@/components/GrammarCorrection";
import RuleCard from "@/components/RuleCard";
import ScoreRing from "@/components/ScoreRing";
import SpeechButton from "@/components/SpeechButton";
import SpeakButton from "@/components/SpeakButton";
import { useSpeech } from "@/lib/useSpeech";
import { useRealtimeVoice, RealtimeState } from "@/lib/useRealtimeVoice";
import { VoiceTurnAnalysis } from "@/lib/realtimeTools";
import { Token, LearnerModel, ConversationState, CefrLevel, CorrectionLevel } from "@/types";
import AuthGuard from "@/components/AuthGuard";
import {
  takeSnapshot,
  generateSessionSummary,
  loadSnapshots,
  loadSummaries,
  getSmartTopicRecommendations,
  detectPersistentErrors,
  SessionSummary,
  MasterySnapshot,
  PersistentErrorAlert,
} from "@/lib/sessionMemory";

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

interface ActiveRule {
  structureId: string;
  structureName: string;
  description: string;
  l1Comparison: string | null;
  errorCount: number;
  mastery: number;
  lessonId: string | null;
}

interface DeepPracticeNudge {
  structureId: string;
  structureName: string;
  errorCount: number;
  mastery: number;
  lessonId: string;
  message: string;
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
  activeRule: ActiveRule | null;
  deepPracticeNudge: DeepPracticeNudge | null;
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

function HomeContent() {
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
  const [voiceChoice, setVoiceChoice] = useState<TTSVoice>("nova");
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [realtimeMode, setRealtimeMode] = useState(false);
  const [realtimeTranscript, setRealtimeTranscript] = useState("");
  const [realtimeModelText, setRealtimeModelText] = useState("");
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurnAnalysis[]>([]);
  const [dismissedNudges, setDismissedNudges] = useState<string[]>([]);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const voiceScrollRef = useRef<HTMLDivElement>(null);
  const voiceScrollContainerRef = useRef<HTMLDivElement>(null);
  const voiceIsNearBottomRef = useRef(true);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSentence, setStreamingSentence] = useState("");
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [topicRecs, setTopicRecs] = useState<{ structureId: string; name: string; reason: string; priority: number }[]>([]);
  const [persistentAlerts, setPersistentAlerts] = useState<PersistentErrorAlert[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const sessionStartModelRef = useRef<LearnerModel | null>(null);

  // Speech synthesis — auto-speaks all coach responses
  const { speak, stop, speaking, supported: ttsSupported } = useSpeech({
    voice: voiceChoice,
    onEnd: () => {
      // Speak queued follow-up prompt (nextPrompt) after coach message finishes
      if (pendingPromptRef.current) {
        const prompt = pendingPromptRef.current;
        pendingPromptRef.current = null;
        setTimeout(() => speak(prompt), 300);
      }
    },
  });

  // Realtime voice (OpenAI WebRTC) — used in voice conversation mode
  const realtime = useRealtimeVoice({
    learnerModel,
    conversationState: convState,
    dismissedNudges,
    callbacks: {
      onUserTranscript: (text, isFinal) => {
        if (isFinal) {
          setRealtimeTranscript(text);
        } else {
          setRealtimeTranscript((prev) => prev + text);
        }
      },
      onModelText: (text) => {
        // Live "model speaking" text — we only show it briefly before the
        // rich turn card lands. Kept for when tool analysis is delayed.
        setRealtimeModelText((prev) => prev + text);
      },
      onModelUpdate: (model, state) => {
        setLearnerModel(model);
        setConvState(state);
        saveModel(model);
      },
      onTurnAnalysis: (analysis) => {
        // Commit the finalized turn into history and clear the live bubbles
        setVoiceTurns((prev) => [...prev, analysis]);
        setRealtimeTranscript("");
        setRealtimeModelText("");
      },
      onError: (msg) => {
        console.error("Realtime error:", msg);
        setRealtimeError(msg);
        setRealtimeMode(false);
      },
      onStateChange: () => {
        // Turn history lives in voiceTurns — do NOT wipe it here.
        // Live bubbles clear when onTurnAnalysis commits the turn.
      },
    },
  });

  function toggleRealtimeMode() {
    if (realtimeMode) {
      realtime.disconnect();
      setRealtimeMode(false);
      setRealtimeTranscript("");
      setRealtimeModelText("");
      setVoiceTurns([]);
      setDismissedNudges([]);
    } else {
      setRealtimeError(null);
      setRealtimeMode(true);
      setVoiceTurns([]);
      setDismissedNudges([]);
      stop(); // stop any TTS
      realtime.connect();
    }
  }

  // Auto-scroll voice conversation — but only if the learner is already near
  // the bottom. If they've scrolled up to read a correction, respect that.
  useEffect(() => {
    if (!realtimeMode) return;
    if (!voiceIsNearBottomRef.current) return;
    voiceScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [voiceTurns, realtimeTranscript, realtimeMode]);

  function handleVoiceScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    voiceIsNearBottomRef.current = distanceFromBottom < 120;
  }

  // ── Adaptive focus steering ──
  // After each voice turn, if the focus structure or deep-practice signal
  // has changed, push a system note into the Realtime conversation so
  // GPT-4o steers the next couple of questions accordingly.
  const lastSteeredFocusRef = useRef<string | null>(null);
  const lastSteeredNudgeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!realtimeMode || voiceTurns.length === 0) return;
    const last = voiceTurns[voiceTurns.length - 1];
    const currentFocus = last.activeRule?.structureName ?? null;
    const currentNudgeId = last.deepPracticeNudge?.structureId ?? null;

    const focusChanged = currentFocus !== lastSteeredFocusRef.current;
    const nudgeChanged =
      currentNudgeId !== null && currentNudgeId !== lastSteeredNudgeRef.current;
    if (!focusChanged && !nudgeChanged) return;

    const notes: string[] = [];
    if (currentFocus && focusChanged) {
      const mastery = last.activeRule ? Math.round(last.activeRule.mastery * 100) : null;
      const errs = last.activeRule?.errorCount ?? 0;
      const parts = [
        `Steer the next 1–2 questions toward eliciting "${currentFocus}" in German.`,
      ];
      if (errs > 0) parts.push(`Recent mistakes on this topic: ${errs}.`);
      if (mastery !== null) parts.push(`Mastery: ${mastery}%.`);
      notes.push(parts.join(" "));
    }
    if (last.deepPracticeNudge && nudgeChanged) {
      notes.push(
        `The learner has made ${last.deepPracticeNudge.errorCount} mistakes on "${last.deepPracticeNudge.structureName}" ` +
        `(mastery ${last.deepPracticeNudge.mastery}%). In your next reply, briefly offer — one short sentence — ` +
        `to switch into a focused lesson on this topic, then continue the conversation with the nextPrompt.`
      );
    }

    if (notes.length > 0) {
      realtime.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `[Tutor-engine steering note — do not read this aloud]\n${notes.join("\n")}`,
            },
          ],
        },
      });
      lastSteeredFocusRef.current = currentFocus;
      if (currentNudgeId) lastSteeredNudgeRef.current = currentNudgeId;
    }
  }, [voiceTurns, realtimeMode, realtime]);

  // ── Verbal drill announcement ──
  // When session errors on a structure hit the drill threshold, inject a
  // one-shot system note so the voice coach pivots mid-conversation into a
  // short focused drill — no card, no interruption, just the tutor saying
  // "let's slow down on this" and asking 3–4 targeted questions.
  const DRILL_ANNOUNCE_THRESHOLD = 3;
  const announcedDrillsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!realtimeMode || voiceTurns.length === 0) return;
    const last = voiceTurns[voiceTurns.length - 1];
    if (last.errorStructureIds.length === 0) return;

    for (const structureId of last.errorStructureIds) {
      if (announcedDrillsRef.current.has(structureId)) continue;
      const sessionErrors = voiceTurns.filter((t) =>
        t.errorStructureIds.includes(structureId)
      ).length;
      if (sessionErrors < DRILL_ANNOUNCE_THRESHOLD) continue;

      const structureName =
        last.activeRule?.structureId === structureId
          ? last.activeRule.structureName
          : last.deepPracticeNudge?.structureId === structureId
          ? last.deepPracticeNudge.structureName
          : structureId;

      realtime.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                `[Tutor drill cue — do not read this aloud as-is] ` +
                `The learner has made ${sessionErrors} mistakes on "${structureName}" in this conversation. ` +
                `In your next spoken reply: (1) briefly acknowledge it in ONE short friendly sentence like ` +
                `"Let's slow down on ${structureName} for a bit" or "I can see this one's tripping you up — let me help", ` +
                `(2) then ask a simple, targeted German question that specifically requires "${structureName}". ` +
                `Keep your next 3–4 questions focused on "${structureName}" until they use it correctly, ` +
                `then celebrate warmly and return to natural conversation. ` +
                `Do NOT suggest switching to a separate lesson — the app's UI handles that silently.`,
            },
          ],
        },
      });
      announcedDrillsRef.current.add(structureId);
    }
  }, [voiceTurns, realtimeMode, realtime]);

  // Reset steering trackers when leaving voice mode
  useEffect(() => {
    if (!realtimeMode) {
      lastSteeredFocusRef.current = null;
      lastSteeredNudgeRef.current = null;
      announcedDrillsRef.current = new Set();
    }
  }, [realtimeMode]);

  // Load voice choice preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(VOICE_CHOICE_KEY) as TTSVoice | null;
      if (saved) setVoiceChoice(saved);
    }
  }, []);

  // ── Load or initialize learner model ──
  useEffect(() => {
    const saved = loadModel();
    if (saved) {
      setLearnerModel(saved);
      sessionStartModelRef.current = JSON.parse(JSON.stringify(saved));
      setNeedsLanguage(false);
      initSession(saved.nativeLanguage, saved);
      // Load cross-session intelligence
      const snapshots = loadSnapshots();
      setTopicRecs(getSmartTopicRecommendations(saved, snapshots));
      setPersistentAlerts(detectPersistentErrors(saved, snapshots));
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
        const snapshots = loadSnapshots();
        const recs = getSmartTopicRecommendations(existingModel, snapshots);
        setTopicRecs(recs);
        setOpener(getSessionOpener(existingModel, recs));
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
      const snapshots = loadSnapshots();
      const recs = getSmartTopicRecommendations(model, snapshots);
      setTopicRecs(recs);
      setOpener(getSessionOpener(model, recs));
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

  // Auto-speak opener on session start
  const openerSpokenRef = useRef(false);
  useEffect(() => {
    if (opener && !initializing && !openerSpokenRef.current) {
      openerSpokenRef.current = true;
      speak(opener);
    }
  }, [opener, initializing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear manual speak index when TTS stops
  useEffect(() => {
    if (!speaking) setSpeakingIdx(null);
  }, [speaking]);

  // Speech input handler — fills the text input
  function handleSpeechResult(text: string) {
    setInput(text);
  }

  // Stop TTS when mic starts so they don't overlap
  function handleListeningChange(listening: boolean) {
    if (listening) {
      stop();
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
          persistentErrors: persistentAlerts
            .filter((a) => a.severity !== "watch")
            .map((a) => a.structureName),
          sessionFocus: topicRecs.slice(0, 3).map((r) => r.name),
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
              // Auto-speak coach response
              speak(event.text);
            } else if (event.type === "analysis") {
              const result: ConverseTurnResult = event.data;
              setTurns((prev) => [...prev, { sentence: text, result }]);
              setLearnerModel(result.updatedModel);
              setConvState(result.updatedState);
              saveModel(result.updatedModel);
              setStreamingText("");
              setStreamingSentence("");
              // Always queue nextPrompt to speak after coach message TTS finishes
              if (result.nextPrompt) {
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
    stop();
    if (learnerModel && turns.length > 0) {
      // Take mastery snapshot before ending session
      const snapshot = takeSnapshot(learnerModel);

      // Generate session summary (comparing start vs end of session)
      const startModel = sessionStartModelRef.current ?? learnerModel;
      const structuresPracticed = convState?.sessionStructuresCovered ?? [];
      const summary = generateSessionSummary(
        startModel,
        learnerModel,
        turns.length,
        structuresPracticed
      );
      setSessionSummary(summary);
      setShowSummary(true);

      // Refresh persistent error alerts
      const snapshots = loadSnapshots();
      setPersistentAlerts(detectPersistentErrors(learnerModel, snapshots));

      // Update topic recommendations for next session
      setTopicRecs(getSmartTopicRecommendations(learnerModel, snapshots));
    }

    // Reset for new session
    setTurns([]);
    if (learnerModel) {
      const updatedModel = { ...learnerModel, sessionCount: learnerModel.sessionCount + 1 };
      setLearnerModel(updatedModel);
      saveModel(updatedModel);
      sessionStartModelRef.current = JSON.parse(JSON.stringify(updatedModel));
      initSession(updatedModel.nativeLanguage, updatedModel);
    }
  }

  // ── Computed values ──
  const latestLevel = turns.length > 0
    ? turns[turns.length - 1].result.detectedLevel
    : learnerModel?.detectedLevel ?? null;
  const totalStructures = learnerModel?.structures.length ?? 0;
  const weakStructures = learnerModel?.structures.filter((s) => s.mastery < 0.5).length ?? 0;

  // Active rule from the latest turn (for sidebar display)
  const latestActiveRule = turns.length > 0
    ? turns[turns.length - 1].result.activeRule
    : null;

  // Deep practice nudge from the latest turn
  const latestDeepPracticeNudge = turns.length > 0
    ? turns[turns.length - 1].result.deepPracticeNudge
    : null;

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
              title="Language the coach explains in (not the language you're learning)"
            >
              Coach: {learnerModel?.coachLanguage ?? "English"}
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
          {/* Voice picker */}
          {ttsSupported && (
            <div className="relative">
              <button
                onClick={() => setShowVoiceMenu(!showVoiceMenu)}
                className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-200 transition-colors"
                title="Change coach voice"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
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
          )}
          {/* Realtime voice chat toggle */}
          {realtime.isSupported && (
            <button
              onClick={toggleRealtimeMode}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                realtimeMode
                  ? "bg-red-100 text-red-700 hover:bg-red-200"
                  : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
              }`}
              title={realtimeMode ? "End voice conversation" : "Start real-time voice conversation"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {realtimeMode ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </>
                )}
              </svg>
              {realtimeMode ? "End Voice" : "Voice Chat"}
            </button>
          )}
          <button onClick={startNewSession} className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
            New Session
          </button>
          <button onClick={() => router.push("/progress")} className="text-xs text-gray-400 hover:text-gray-600">
            Overview &rarr;
          </button>
        </div>
      </header>

      {/* Session Summary Modal */}
      {showSummary && sessionSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Session Complete</h3>
            <p className="text-sm text-gray-600">{sessionSummary.summaryText}</p>

            {/* Mastery changes */}
            {sessionSummary.masteryDeltas.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Progress this session</p>
                {sessionSummary.masteryDeltas.map((d) => (
                  <div key={d.structureId} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{d.name}</span>
                    <span className={d.after > d.before ? "text-green-600" : "text-red-500"}>
                      {Math.round(d.before * 100)}% → {Math.round(d.after * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Strength / Weakness */}
            <div className="flex gap-3 text-xs">
              {sessionSummary.topStrength && (
                <div className="flex-1 rounded-lg bg-green-50 px-3 py-2">
                  <p className="font-medium text-green-800">Strength</p>
                  <p className="text-green-600">{sessionSummary.topStrength}</p>
                </div>
              )}
              {sessionSummary.topWeakness && (
                <div className="flex-1 rounded-lg bg-amber-50 px-3 py-2">
                  <p className="font-medium text-amber-800">Focus next</p>
                  <p className="text-amber-600">{sessionSummary.topWeakness}</p>
                </div>
              )}
            </div>

            {/* Stats row */}
            <div className="flex gap-3 text-center text-xs text-gray-500">
              <div className="flex-1 rounded-lg bg-gray-50 py-2">
                <p className="text-lg font-bold text-gray-900">{sessionSummary.turnCount}</p>
                <p>exchanges</p>
              </div>
              <div className="flex-1 rounded-lg bg-gray-50 py-2">
                <p className="text-lg font-bold text-gray-900">{sessionSummary.errorsThisSession}</p>
                <p>corrected</p>
              </div>
              <div className="flex-1 rounded-lg bg-gray-50 py-2">
                <p className="text-lg font-bold text-gray-900">{sessionSummary.structuresPracticed.length}</p>
                <p>topics</p>
              </div>
            </div>

            {/* Topic recommendations for next session */}
            {topicRecs.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Recommended next</p>
                {topicRecs.slice(0, 3).map((rec) => (
                  <div key={rec.structureId} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <span className="font-medium text-gray-700">{rec.name}</span>
                    <span className="text-gray-400">{rec.reason}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowSummary(false)}
              className="w-full rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Start Next Session
            </button>
          </div>
        </div>
      )}

      {/* Voice error toast (e.g. daily cap hit, connection failed) */}
      {realtimeError && !realtimeMode && (
        <div className="fixed top-20 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg max-w-md">
            <div className="flex-1 text-sm text-amber-900">
              {realtimeError}
            </div>
            <button
              onClick={() => setRealtimeError(null)}
              className="text-amber-600 hover:text-amber-800"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Realtime voice conversation overlay */}
      {realtimeMode && (() => {
        const latestVoice = voiceTurns.length > 0 ? voiceTurns[voiceTurns.length - 1] : null;
        const voiceActiveRule = latestVoice?.activeRule ?? null;
        const voiceNudge = latestVoice?.deepPracticeNudge ?? null;
        const voiceFocusName = voiceActiveRule?.structureName ?? null;

        // Session-scoped error count on the candidate handoff structure.
        // We only show the handoff CTA once the learner has struggled on this
        // topic in THIS conversation (not just cumulative lifetime), and only
        // if they haven't dismissed it. Progressive adaptation still happens
        // silently via focus drilling + the active-rule card.
        const SESSION_NUDGE_THRESHOLD = 3;
        const nudgeSessionErrors = voiceNudge
          ? voiceTurns.filter((t) => t.errorStructureIds.includes(voiceNudge.structureId)).length
          : 0;
        const showHandoffCta =
          voiceNudge !== null &&
          nudgeSessionErrors >= SESSION_NUDGE_THRESHOLD &&
          !dismissedNudges.includes(voiceNudge.structureId);

        function handleVoiceLessonJump(lessonId: string) {
          realtime.disconnect();
          setRealtimeMode(false);
          setVoiceTurns([]);
          setDismissedNudges([]);
          setRealtimeTranscript("");
          setRealtimeModelText("");
          router.push(`/chat?lesson=${lessonId}`);
        }

        function dismissNudge(structureId: string) {
          setDismissedNudges((prev) =>
            prev.includes(structureId) ? prev : [...prev, structureId]
          );
        }

        const stateLabel =
          realtime.state === "connecting" ? "Connecting…" :
          realtime.state === "listening" ? "Listening — speak in German" :
          realtime.state === "thinking" ? "Analyzing your sentence…" :
          realtime.state === "speaking" ? "Coach is speaking…" :
          "Disconnected";

        const stateColor =
          realtime.state === "listening" ? "bg-emerald-100 text-emerald-700" :
          realtime.state === "speaking" ? "bg-blue-100 text-blue-700" :
          realtime.state === "thinking" ? "bg-amber-100 text-amber-700" :
          realtime.state === "connecting" ? "bg-gray-200 text-gray-600" :
          "bg-gray-100 text-gray-500";

        return (
          <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
            {/* Compact header: state pill + focus badge */}
            <div className="border-b border-gray-200 bg-white px-6 py-3">
              <div className="mx-auto flex max-w-2xl items-center gap-3">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${stateColor}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    realtime.state === "listening" ? "bg-emerald-600 animate-pulse" :
                    realtime.state === "speaking" ? "bg-blue-600 animate-pulse" :
                    realtime.state === "thinking" ? "bg-amber-600 animate-pulse" :
                    "bg-gray-400"
                  }`} />
                  {stateLabel}
                </span>
                {voiceFocusName && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white">
                    Focus: {voiceFocusName}
                    {voiceActiveRule && voiceActiveRule.errorCount > 0 && (
                      <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                        {voiceActiveRule.errorCount}×
                      </span>
                    )}
                  </span>
                )}
                <button
                  onClick={toggleRealtimeMode}
                  className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                >
                  End Voice
                </button>
              </div>
            </div>

            {/* Scrollable conversation */}
            <div
              ref={voiceScrollContainerRef}
              onScroll={handleVoiceScroll}
              className="flex-1 overflow-y-auto px-6 py-6"
            >
              <div className="mx-auto max-w-2xl space-y-5">
                {/* Empty-state hint */}
                {voiceTurns.length === 0 && !realtimeTranscript && (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center">
                    <p className="text-sm text-gray-600">
                      Start speaking in German. I&apos;ll catch your mistakes, walk you through them,
                      and steer our chat toward whatever needs the most work.
                    </p>
                  </div>
                )}

                {/* Committed turns — rich breakdown per turn */}
                {voiceTurns.map((turn, i) => {
                  const isLast = i === voiceTurns.length - 1;
                  const ruleTokens: Token[] = turn.tokens.filter(
                    (t) => (t.status === "wrong" || t.status === "warn") && (t.correction || t.rule)
                  );
                  return (
                    <div key={i} className="fade-in-up space-y-3">
                      {/* User sentence */}
                      <div className="flex justify-end">
                        <div className="max-w-sm rounded-2xl rounded-br-md bg-gray-900 px-4 py-3 text-sm text-white">
                          {turn.sentence}
                        </div>
                      </div>

                      {/* Coach card: score + response */}
                      <div className="flex gap-3">
                        <div className="score-pop">
                          <ScoreRing score={turn.score} size={44} />
                        </div>
                        <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                          <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                            __html: safeMarkdown(turn.responseText)
                          }} />
                        </div>
                      </div>

                      {/* Token-level corrections */}
                      {turn.corrections.length > 0 && (
                        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
                          <GrammarCorrection
                            tokens={turn.tokens}
                            score={turn.score}
                            errorTypes={turn.corrections.map((c) => c.level)}
                          />
                        </div>
                      )}

                      {/* Explicit rule card on latest turn */}
                      {isLast && turn.ruleCard && (
                        <div className="rule-card-enter rounded-xl border border-gray-200 bg-white p-5">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                            {turn.ruleCard.structureName}
                          </p>
                          <p className="mt-2 text-sm text-gray-700">{turn.ruleCard.rule}</p>
                          {turn.ruleCard.l1Comparison && (
                            <p className="mt-2 text-sm text-gray-500 italic">
                              {turn.ruleCard.l1Comparison}
                            </p>
                          )}
                          <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm font-mono text-gray-600">
                            {turn.ruleCard.example}
                          </p>
                        </div>
                      )}

                      {/* Per-token rule cards on latest turn */}
                      {isLast && !turn.ruleCard && ruleTokens.length > 0 && (
                        <div className="space-y-2">
                          {ruleTokens.map((token, j) => (
                            <RuleCard key={j} token={token} index={j} />
                          ))}
                        </div>
                      )}

                      {/* Active-rule sidebar-style card on latest turn */}
                      {isLast && turn.activeRule && !turn.ruleCard && (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                              {turn.focusStructure ? "Drilling" : "Current rule"}
                            </p>
                            <span className="text-[10px] text-gray-400">
                              {Math.round(turn.activeRule.mastery * 100)}% mastery
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-800">{turn.activeRule.structureName}</p>
                          <p className="text-xs text-gray-600">{turn.activeRule.description}</p>
                          {turn.activeRule.l1Comparison && (
                            <p className="text-xs text-gray-500 italic">{turn.activeRule.l1Comparison}</p>
                          )}
                        </div>
                      )}

                      {/* Handoff chip — silent, one-line, dismissable. The verbal drill
                          is announced by the voice coach itself (see announcedDrillsRef).
                          This chip just leaves a door open to the dedicated lesson. */}
                      {isLast && showHandoffCta && voiceNudge && (
                        <div className="fade-in-up flex items-stretch gap-1.5">
                          <button
                            onClick={() => handleVoiceLessonJump(voiceNudge.lessonId)}
                            className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                          >
                            <span>Focused lesson on</span>
                            <span className="font-medium text-gray-800">{voiceNudge.structureName}</span>
                            <span className="ml-auto text-gray-400">&rarr;</span>
                          </button>
                          <button
                            onClick={() => dismissNudge(voiceNudge.structureId)}
                            className="rounded-lg px-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            aria-label="Dismiss"
                            title="Dismiss for this session"
                          >
                            &times;
                          </button>
                        </div>
                      )}

                      {/* Lighter lesson suggestion — same chip style */}
                      {isLast && !showHandoffCta && turn.lessonSuggestion && (
                        <button
                          onClick={() => handleVoiceLessonJump(turn.lessonSuggestion!.lessonId)}
                          className="fade-in-up flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          <span className="truncate">{turn.lessonSuggestion.message}</span>
                          <span className="ml-auto shrink-0 text-gray-400">&rarr;</span>
                        </button>
                      )}

                      {/* Try-next suggestion — visual only. Coach does NOT speak this;
                          the learner decides when they're ready to respond. */}
                      {isLast && turn.nextPrompt && (
                        <div className="fade-in-up rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Try next — when you&apos;re ready
                          </p>
                          <p className="text-sm text-gray-600">{turn.nextPrompt}</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* In-flight live transcript (user currently speaking) */}
                {realtimeTranscript && (
                  <div className="fade-in-up flex justify-end">
                    <div className="max-w-sm rounded-2xl rounded-br-md bg-gray-900/80 px-4 py-3 text-sm text-white">
                      {realtimeTranscript}
                      <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-white/60 align-middle" />
                    </div>
                  </div>
                )}

                {/* Analyzing indicator while tool call is in flight */}
                {realtime.state === "thinking" && (
                  <div className="fade-in-up flex gap-3">
                    <div className="w-[44px]" />
                    <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-400 ring-1 ring-gray-100">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                        <span className="ml-2">Checking your grammar…</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Transient live coach text while speaking, before a turn commits */}
                {realtimeModelText && realtime.state === "speaking" && (
                  <div className="fade-in-up flex gap-3">
                    <div className="w-[44px]" />
                    <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                      {realtimeModelText}
                    </div>
                  </div>
                )}

                <div ref={voiceScrollRef} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Main area: conversation + sidebar */}
      {!realtimeMode && <div className="flex flex-1 overflow-hidden">

      {/* Conversation column */}
      <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-lg space-y-5">
          {/* Topic recommendations — shown at start of session before any turns */}
          {topicRecs.length > 0 && turns.length === 0 && opener && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Today&apos;s focus</p>
              <div className="flex flex-wrap gap-2">
                {topicRecs.slice(0, 4).map((rec) => (
                  <span
                    key={rec.structureId}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${
                      rec.priority <= 2
                        ? "bg-gray-900 text-white"
                        : "bg-gray-200 text-gray-600"
                    }`}
                    title={rec.reason}
                  >
                    {rec.name}
                  </span>
                ))}
              </div>
            </div>
          )}

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

                {/* Deep practice nudge — prominent when error pattern is clear */}
                {i === turns.length - 1 && turn.result.deepPracticeNudge && (
                  <div className="fade-in-up rounded-xl border-2 border-gray-900 bg-gray-50 p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Your tutor recommends
                    </p>
                    <p className="text-sm text-gray-700">{turn.result.deepPracticeNudge.message}</p>
                    <button
                      onClick={() => router.push(`/chat?lesson=${turn.result.deepPracticeNudge!.lessonId}`)}
                      className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
                    >
                      Start focused practice
                    </button>
                  </div>
                )}

                {/* Lesson suggestion — lighter version for 2 errors */}
                {i === turns.length - 1 && !turn.result.deepPracticeNudge && turn.result.lessonSuggestion && (
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

      {/* Input bar — mic + text + send */}
      <div className="border-t border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-lg gap-2">
          <SpeechButton
            onResult={handleSpeechResult}
            onInterim={(text) => setInput(text)}
            onListeningChange={handleListeningChange}
            disabled={loading || speaking}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write or speak a German sentence..."
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

      {/* Right sidebar — grammar rules + weak areas */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l border-gray-200 bg-white overflow-y-auto">
        <div className="px-4 py-4 space-y-5">
          {/* Active grammar rule — shown during drilling or after errors */}
          {latestActiveRule && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {convState?.focusStructure ? "Drilling" : "Current Rule"}
                </p>
                <span className="text-[10px] text-gray-400">
                  {Math.round(latestActiveRule.mastery * 100)}% mastery
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">{latestActiveRule.structureName}</p>
                <p className="mt-1 text-xs text-gray-600">{latestActiveRule.description}</p>
              </div>
              {latestActiveRule.l1Comparison && (
                <div className="rounded-lg bg-white px-3 py-2 border border-gray-100">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-1">
                    In your language
                  </p>
                  <p className="text-xs text-gray-600 italic">{latestActiveRule.l1Comparison}</p>
                </div>
              )}
              {latestActiveRule.errorCount > 0 && (
                <p className="text-[10px] text-gray-400">
                  {latestActiveRule.errorCount} mistake{latestActiveRule.errorCount !== 1 ? "s" : ""} so far
                </p>
              )}
              {latestActiveRule.lessonId && (
                <button
                  onClick={() => router.push(`/chat?lesson=${latestActiveRule!.lessonId}`)}
                  className="w-full rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-medium text-white hover:bg-gray-800 transition-colors"
                >
                  Deep practice this topic
                </button>
              )}
            </div>
          )}

          {/* Cross-session alerts */}
          {persistentAlerts.filter((a) => a.severity === "intervention").length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-red-500 mb-2">Needs attention</p>
              <div className="space-y-1.5">
                {persistentAlerts.filter((a) => a.severity === "intervention").map((alert) => (
                  <div key={alert.structureId} className="rounded-lg bg-red-50 px-3 py-2">
                    <p className="text-[11px] font-medium text-red-800">{alert.structureName}</p>
                    <p className="text-[10px] text-red-600">{alert.totalCount} errors · {alert.sessionsWithError} sessions</p>
                  </div>
                ))}
              </div>
            </div>
          )}

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

      </div>}{/* end main flex area (conditional) */}
    </div>
  );
}

export default function Home() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  );
}
