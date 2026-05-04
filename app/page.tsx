"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GrammarCorrection from "@/components/GrammarCorrection";
import RuleCard from "@/components/RuleCard";
import ScoreRing from "@/components/ScoreRing";
import BrandMark from "@/components/BrandMark";
import ActivityCard from "@/components/ActivityCard";
import VocabCard from "@/components/VocabCard";
import GrammarTable from "@/components/GrammarTable";
import ThinkingMark from "@/components/ThinkingMark";
import { GRAMMAR_STRUCTURES } from "@/lib/grammarStructures";
import SpeechButton from "@/components/SpeechButton";
import { useSpeech } from "@/lib/useSpeech";
import { useRealtimeVoice } from "@/lib/useRealtimeVoice";
import { VoiceTurnAnalysis } from "@/lib/realtimeTools";
import { buildRealtimeInstructions } from "@/lib/realtimeInstructions";
import { Token, LearnerModel, ConversationState, CefrLevel, CorrectionLevel } from "@/types";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/AuthContext";
import { loadLearnerModel, saveLearnerModel } from "@/lib/learnerModelSync";
import { getLessonForStructure } from "@/lib/learningPath";
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
import { saveSnapshot, saveSummary } from "@/lib/sessionMemorySync";
import { loadCachedSession, saveCachedSession, clearCachedSession } from "@/lib/sessionChatCache";

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
  structureId: string;
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

function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={28} />
      <span className="text-sm font-semibold tracking-[-0.01em] text-gray-900">GrammarFlow</span>
    </div>
  );
}

function formatRecency(value: string | null | undefined) {
  if (!value) return "first surfaced recently";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "first surfaced recently";
  const days = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (days === 0) return "surfaced today";
  if (days === 1) return "surfaced yesterday";
  return `first surfaced ${days}d ago`;
}

function HomeContent() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;

  // Stable refs so callbacks don't go stale when auth resolves later.
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;

  // Sync wrappers: always write local, mirror to Supabase when signed in.
  // Load is async — callers must await or handle the promise.
  const loadModel = useCallback(
    () => loadLearnerModel(userIdRef.current),
    []
  );
  const saveModel = useCallback((model: LearnerModel) => {
    // Fire-and-forget so save never blocks the render loop.
    void saveLearnerModel(model, userIdRef.current);
  }, []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const voiceParam = searchParams.get("voice");
  const focusParam = searchParams.get("focus");
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
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // ── Realtime voice (unified — runs alongside text input) ──
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [pendingModelText, setPendingModelText] = useState("");
  // Voice-only analyses for the *current* realtime session — drives drill
  // announcements and focus-steering. Cleared on disconnect.
  const [voiceSessionAnalyses, setVoiceSessionAnalyses] = useState<VoiceTurnAnalysis[]>([]);
  const [dismissedNudges, setDismissedNudges] = useState<string[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSentence, setStreamingSentence] = useState("");
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [topicRecs, setTopicRecs] = useState<{ structureId: string; name: string; reason: string; priority: number }[]>([]);
  const [persistentAlerts, setPersistentAlerts] = useState<PersistentErrorAlert[]>([]);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  // Pinned reference cards — chronological order, newest appended at the end so
  // the latest pin sits at the bottom of the left rail (closest to the chat input).
  const [pinnedStructureIds, setPinnedStructureIds] = useState<string[]>([]);
  // Guard: skip the very first save effect run so we don't clobber the saved
  // value with the initial empty state before the load effect has hydrated it.
  const collapseHydratedRef = useRef(false);
  const pinsHydratedRef = useRef(false);
  useEffect(() => {
    const savedRight = localStorage.getItem("gf:rightRailCollapsed");
    if (savedRight === "1") setRightRailCollapsed(true);
    const savedPins = localStorage.getItem("gf:pinnedStructures");
    if (savedPins) {
      try {
        const parsed = JSON.parse(savedPins);
        if (Array.isArray(parsed)) setPinnedStructureIds(parsed.filter((x) => typeof x === "string"));
      } catch {}
    }
  }, []);
  useEffect(() => {
    if (!collapseHydratedRef.current) {
      collapseHydratedRef.current = true;
      return;
    }
    localStorage.setItem("gf:rightRailCollapsed", rightRailCollapsed ? "1" : "0");
  }, [rightRailCollapsed]);
  useEffect(() => {
    if (!pinsHydratedRef.current) {
      pinsHydratedRef.current = true;
      return;
    }
    localStorage.setItem("gf:pinnedStructures", JSON.stringify(pinnedStructureIds));
  }, [pinnedStructureIds]);
  const togglePinStructure = useCallback((id: string) => {
    setPinnedStructureIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);
  const pinStructure = useCallback((id: string) => {
    setPinnedStructureIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const unpinStructure = useCallback((id: string) => {
    setPinnedStructureIds((prev) => prev.filter((x) => x !== id));
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const sessionStartModelRef = useRef<LearnerModel | null>(null);

  // Speech synthesis — streams coach responses sentence-by-sentence via enqueue()
  const { speak, enqueue: enqueueSpeech, stop, speaking, supported: ttsSupported } = useSpeech({
    voice: voiceChoice,
    language: learnerModel?.coachLanguage ?? undefined,
    onEnd: () => {
      // Speak queued follow-up prompt (nextPrompt) after coach message finishes
      if (pendingPromptRef.current) {
        const prompt = pendingPromptRef.current;
        pendingPromptRef.current = null;
        setTimeout(() => speak(prompt), 300);
      }
    },
  });

  // Realtime voice (OpenAI WebRTC) — engaged from the input-bar mic toggle.
  // onTurnAnalysis adapts the voice result into the same `turns` shape that
  // text input produces, so the rest of the UI (corrections, rule cards,
  // deep-practice nudge, focus rail, pinned references) renders identically.
  const realtime = useRealtimeVoice({
    learnerModel,
    conversationState: convState,
    dismissedNudges,
    callbacks: {
      onUserTranscript: (text, isFinal) => {
        if (isFinal) {
          setPendingTranscript(text);
        } else {
          setPendingTranscript((prev) => prev + text);
        }
      },
      onTranscriptRejected: () => {
        setPendingTranscript("");
      },
      onModelText: (text) => {
        setPendingModelText((prev) => prev + text);
      },
      onModelUpdate: (model, state) => {
        setLearnerModel(model);
        setConvState(state);
        saveModel(model);
      },
      onTurnAnalysis: (analysis) => {
        const referenceStructureId =
          analysis.ruleCard?.structureId ??
          analysis.activeRule?.structureId ??
          analysis.deepPracticeNudge?.structureId ??
          null;
        if (referenceStructureId && analysis.corrections.length > 0) {
          pinStructure(referenceStructureId);
        }
        // Commit a unified Turn so it slots into the same render pipeline
        // text input uses. updatedModel/updatedState aren't read for render
        // — onModelUpdate already pushed those into state.
        setTurns((prev) => [
          ...prev,
          {
            sentence: analysis.sentence,
            result: {
              responseText: analysis.responseText,
              corrections: analysis.corrections,
              ruleCard: analysis.ruleCard,
              nextPrompt: analysis.nextPrompt,
              score: analysis.score,
              detectedLevel: analysis.detectedLevel,
              tokens: analysis.tokens,
              updatedModel: learnerModelRef.current ?? ({} as LearnerModel),
              updatedState: convStateRef.current ?? ({} as ConversationState),
              lessonSuggestion: analysis.lessonSuggestion,
              activeRule: analysis.activeRule,
              deepPracticeNudge: analysis.deepPracticeNudge,
            },
          },
        ]);
        setVoiceSessionAnalyses((prev) => [...prev, analysis]);
        setPendingTranscript("");
        setPendingModelText("");
      },
      onError: (msg) => {
        console.error("Realtime error:", msg);
        setVoiceError(msg);
      },
      onStateChange: (s) => {
        if (s === "idle") {
          // Connection ended — clear pending bubbles and per-session voice
          // analyses. The committed turns stay in the unified scrollback.
          setPendingTranscript("");
          setPendingModelText("");
          setVoiceSessionAnalyses([]);
        }
      },
    },
  });

  // Refs so the realtime callbacks can read current state without stale closures.
  const learnerModelRef = useRef<LearnerModel | null>(null);
  learnerModelRef.current = learnerModel;
  const convStateRef = useRef<ConversationState | null>(null);
  convStateRef.current = convState;

  const voiceConnected = realtime.state !== "idle";

  function toggleVoice() {
    if (voiceConnected) {
      realtime.disconnect();
    } else {
      setVoiceError(null);
      stop(); // stop any TTS that was running from text-mode replies
      realtime.connect();
    }
  }

  // ── Adaptive focus steering ──
  // After each voice turn, if the focus structure or deep-practice signal
  // has changed, push a system note into the Realtime conversation so
  // GPT-4o steers the next couple of questions accordingly.
  const lastSteeredFocusRef = useRef<string | null>(null);
  const lastSteeredNudgeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceConnected || voiceSessionAnalyses.length === 0) return;
    const last = voiceSessionAnalyses[voiceSessionAnalyses.length - 1];
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
  }, [voiceSessionAnalyses, voiceConnected, realtime]);

  // ── Verbal drill announcement ──
  // When session errors on a structure hit the drill threshold, inject a
  // one-shot system note so the voice coach pivots mid-conversation into a
  // short focused drill — no card, no interruption, just the tutor saying
  // "let's slow down on this" and asking 3–4 targeted questions.
  const DRILL_ANNOUNCE_THRESHOLD = 3;
  const announcedDrillsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!voiceConnected || voiceSessionAnalyses.length === 0) return;
    const last = voiceSessionAnalyses[voiceSessionAnalyses.length - 1];
    if (last.errorStructureIds.length === 0) return;

    for (const structureId of last.errorStructureIds) {
      if (announcedDrillsRef.current.has(structureId)) continue;
      const sessionErrors = voiceSessionAnalyses.filter((t) =>
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
  }, [voiceSessionAnalyses, voiceConnected, realtime]);

  // Reset steering trackers when leaving voice mode
  useEffect(() => {
    if (!voiceConnected) {
      lastSteeredFocusRef.current = null;
      lastSteeredNudgeRef.current = null;
      announcedDrillsRef.current = new Set();
    }
  }, [voiceConnected]);

  // ── Live language switch during voice chat ──
  // When the learner changes the coach language dropdown mid-conversation,
  // rebuild the Realtime session instructions and push them so GPT-4o
  // switches immediately instead of sticking with the language it was
  // born with. Also rebuilds if native language or level changes.
  const coachLanguage = learnerModel?.coachLanguage ?? learnerModel?.nativeLanguage ?? null;
  const nativeLanguage = learnerModel?.nativeLanguage ?? null;
  const detectedLevel = learnerModel?.detectedLevel ?? null;
  const lastPushedLanguageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceConnected) {
      lastPushedLanguageRef.current = null;
      return;
    }
    if (realtime.state === "connecting") return;
    if (!coachLanguage || !nativeLanguage || !detectedLevel) return;

    // Skip the first push — the session was created with these exact values
    // baked in. Only send session.update on ACTUAL changes.
    if (lastPushedLanguageRef.current === null) {
      lastPushedLanguageRef.current = coachLanguage;
      return;
    }
    if (lastPushedLanguageRef.current === coachLanguage) return;

    realtime.sendEvent({
      type: "session.update",
      session: {
        instructions: buildRealtimeInstructions({
          nativeLanguage,
          coachLanguage,
          level: detectedLevel,
          targetLanguage: learnerModel?.targetLanguage,
        }),
      },
    });
    lastPushedLanguageRef.current = coachLanguage;
  }, [coachLanguage, nativeLanguage, detectedLevel, voiceConnected, realtime, learnerModel?.targetLanguage]);

  // Load voice choice preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(VOICE_CHOICE_KEY) as TTSVoice | null;
      if (saved) setVoiceChoice(saved);
    }
  }, []);

  // Auto-engage voice mode + focus structure when arriving from a lesson
  // (?voice=1&focus=<structureId>). Runs once after init, then strips the
  // params so a refresh doesn't re-trigger.
  const autoVoiceHandledRef = useRef(false);
  useEffect(() => {
    if (autoVoiceHandledRef.current) return;
    if (initializing || !learnerModel || !convState) return;
    if (focusParam) {
      setConvState({ ...convState, focusStructure: focusParam, focusRemaining: 5 });
    }
    if (voiceParam === "1" && realtime.isSupported && !voiceConnected) {
      // Defer one tick so the focus state lands before connect() reads it
      setTimeout(() => realtime.connect(), 50);
    }
    if (voiceParam || focusParam) {
      autoVoiceHandledRef.current = true;
      router.replace("/", { scroll: false });
    }
  }, [initializing, learnerModel, convState, voiceParam, focusParam, realtime, voiceConnected, router]);

  // ── Load or initialize learner model ──
  // Waits for auth to resolve, then pulls from Supabase for signed-in users
  // (or localStorage fallback). Re-runs when userId changes (sign in/out).
  useEffect(() => {
    if (auth.loading) return;
    let cancelled = false;
    (async () => {
      const saved = await loadModel();
      if (cancelled) return;
      if (saved) {
        setLearnerModel(saved);
        sessionStartModelRef.current = JSON.parse(JSON.stringify(saved));
        setNeedsLanguage(false);
        initSession(saved.nativeLanguage, saved);
        const snapshots = loadSnapshots();
        setTopicRecs(getSmartTopicRecommendations(saved, snapshots));
        setPersistentAlerts(detectPersistentErrors(saved, snapshots));
      } else {
        setNeedsLanguage(true);
        setInitializing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, auth.loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Hydrate visible scrollback from the hot-tier cache so a refresh keeps
      // the in-flight conversation. The brain state (mastery, errors) is
      // already restored from Supabase higher up; this only covers chat UX.
      const cached = loadCachedSession<Turn, ConversationState>(userIdRef.current);
      if (cached && cached.turns.length > 0) {
        setTurns(cached.turns);
        if (cached.convState) setConvState(cached.convState);
      }
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, loading, streamingText, pendingTranscript, pendingModelText]);

  // Mirror visible chat to the hot-tier cache. Skipped while initializing so
  // we don't write the empty starter state over a freshly hydrated session.
  useEffect(() => {
    if (initializing) return;
    saveCachedSession(userIdRef.current, turns, convState);
  }, [turns, convState, initializing]);

  useEffect(() => {
    if (!loading && !needsLanguage && !initializing) {
      inputRef.current?.focus();
    }
  }, [turns, loading, needsLanguage, initializing]);

  // Speech-to-text input handler — fills the input, user reviews and submits.
  // Same flow as typing, so deep analysis (Sonnet, full breakdown, rule cards
  // with pin) renders just like a typed turn.
  function handleSpeechResult(text: string) {
    setInput(text);
  }

  // Stop any in-flight TTS when the mic activates so they don't overlap.
  function handleListeningChange(listening: boolean) {
    if (listening) stop();
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

      // Sentence-by-sentence TTS: as coach tokens stream in, enqueue each
      // completed sentence so audio starts well before the full message lands.
      // Only advance `spokenUpTo` when we accept a chunk, so partial sentences
      // (and mid-abbreviation dots like "z.B.") stay buffered for later tokens.
      let fullCoachText = "";
      let spokenUpTo = 0;
      const MIN_CHUNK_LEN = 20; // skip tiny chunks to avoid "z.B." splits

      const flushCompleteSentences = (atEnd: boolean) => {
        let lastEnd = spokenUpTo;
        for (let i = spokenUpTo; i < fullCoachText.length; i++) {
          const ch = fullCoachText[i];
          if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
            const next = fullCoachText[i + 1];
            const isBoundary = next === undefined || /\s/.test(next);
            if (!isBoundary) continue;
            const candidate = fullCoachText.slice(lastEnd, i + 1).trim();
            if (candidate.length >= MIN_CHUNK_LEN) {
              enqueueSpeech(candidate);
              lastEnd = i + 1;
            }
          }
        }
        spokenUpTo = lastEnd;
        if (atEnd) {
          const tail = fullCoachText.slice(spokenUpTo).trim();
          if (tail) {
            enqueueSpeech(tail);
            spokenUpTo = fullCoachText.length;
          }
        }
      };

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
              fullCoachText += event.text;
              setStreamingText(fullCoachText);
              flushCompleteSentences(false);
            } else if (event.type === "coachDone") {
              fullCoachText = event.text;
              setStreamingText(event.text);
              flushCompleteSentences(true);
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
    // The hot-tier scrollback is per-session — wipe it so the next visit
    // doesn't re-hydrate stale turns. Brain state (mastery, summaries) lives
    // in Supabase and is unaffected.
    clearCachedSession(userIdRef.current);
    if (learnerModel && turns.length > 0) {
      // Take mastery snapshot before ending session (writes localStorage)
      const snapshot = takeSnapshot(learnerModel);
      // Mirror to Supabase fire-and-forget so cross-device users see history
      void saveSnapshot(snapshot, userId);

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
      void saveSummary(summary, userId);

      // Refresh persistent error alerts
      const snapshots = loadSnapshots();
      setPersistentAlerts(detectPersistentErrors(learnerModel, snapshots));

      // Update topic recommendations for next session
      setTopicRecs(getSmartTopicRecommendations(learnerModel, snapshots));

      // Reset for next visit + bump the session count
      setTurns([]);
      const updatedModel = { ...learnerModel, sessionCount: learnerModel.sessionCount + 1 };
      setLearnerModel(updatedModel);
      saveModel(updatedModel);
      sessionStartModelRef.current = JSON.parse(JSON.stringify(updatedModel));
      initSession(updatedModel.nativeLanguage, updatedModel);

      // Hand off to the dedicated recap route — replaces the modal
      router.push("/session/recap");
      return;
    }

    // No turns → just reset state, stay on /chat
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
            <div className="flex justify-center">
              <BrandLockup />
            </div>
            <p className="mt-2 text-base text-gray-500">Learn through conversation</p>
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
  const latestRuleForSidebar = lastResult?.activeRule ?? null;
  const latestRuleCardForSidebar = lastResult?.ruleCard ?? null;
  const ruleTokens: Token[] = lastResult
    ? lastResult.tokens.filter((t) => (t.status === "wrong" || t.status === "warn") && (t.correction || t.rule))
    : [];
  const currentAnalysisCorrections: Correction[] = lastResult
    ? lastResult.corrections.length > 0
      ? lastResult.corrections
      : ruleTokens
          .filter((token) => token.correction)
          .map((token) => ({
            original: token.word,
            correction: token.correction!,
            level: token.status === "wrong" ? "explicit" : "highlight",
          }))
    : [];

  // ── Mistake highlights for sidebar ──
  const errorPatterns = learnerModel?.errorPatterns ?? [];
  const topMistakes = [...errorPatterns].sort((a, b) => b.count - a.count).slice(0, 5);
  const mistakeOfTheDay = topMistakes[0] ?? null;
  const mistakeStructure = mistakeOfTheDay && learnerModel
    ? learnerModel.structures.find((s) => s.id === mistakeOfTheDay.structureId)
    : null;
  // Pinned reference cards — resolve IDs to definitions, drop any that are no
  // longer in the static list (defensive against stale localStorage entries).
  const pinnedStructureDefs = pinnedStructureIds
    .map((id) => GRAMMAR_STRUCTURES.find((s) => s.id === id) ?? null)
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const showLeftRail = pinnedStructureDefs.length > 0;
  const weakList = learnerModel?.structures.filter((s) => s.mastery < 0.5).sort((a, b) => a.mastery - b.mastery).slice(0, 3) ?? [];
  // Honest focus pick — falls back to "anywhere you'd like" if the model has no signal yet,
  // instead of hardcoding a German-specific term like Akkusativ.
  const dailyPromptFocus = topicRecs[0]?.name ?? weakList[0]?.name ?? null;
  const priorSessionCount = learnerModel?.sessionCount ?? 0;

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <BrandLockup />
          {latestLevel && (
            <span className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-gray-600">
              {latestLevel} &middot; {LEVEL_LABELS[latestLevel]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Coach language selector */}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="rounded-lg bg-chip-bg px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-line"
              title="Language the coach explains in (not the language you're learning)"
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
          {/* Voice picker */}
          {ttsSupported && (
            <div className="relative">
              <button
                onClick={() => setShowVoiceMenu(!showVoiceMenu)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100"
                title="Change coach voice"
                aria-label="Change coach voice"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
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
          {/* Voice chat is now engaged from the input-bar mic button. */}
          <button onClick={startNewSession} className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
            New Session
          </button>
          <button onClick={() => router.push("/progress")} className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
            Mastery
          </button>

          {/* User avatar + menu — only shows when a real user is signed in.
              Skipped on localhost where AuthGuard bypasses auth for dev. */}
          {auth.user && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white transition-colors hover:bg-gray-700"
                title={auth.user.email ?? "Account"}
                aria-label="Account menu"
              >
                {(auth.user.email?.[0] ?? "?").toUpperCase()}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">
                    <div className="font-medium text-gray-700">Signed in as</div>
                    <div className="truncate">{auth.user.email ?? "(no email)"}</div>
                  </div>
                  <button
                    onClick={async () => {
                      setShowUserMenu(false);
                      await auth.signOut();
                      router.push("/login");
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Voice error toast (e.g. daily cap hit, connection failed) */}
      {voiceError && (
        <div className="fixed top-20 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg max-w-md">
            <div className="flex-1 text-sm text-amber-900">
              {voiceError}
            </div>
            <button
              onClick={() => setVoiceError(null)}
              className="text-amber-600 hover:text-amber-800"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Main area: conversation + sidebar */}
      <div className="flex flex-1 overflow-hidden">

      {/* Left rail — pinned reference cards. Hidden when no pins exist; the
          newest pin sits at the bottom (closest to the chat input). */}
      {showLeftRail && (
        <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-gray-200 bg-paper">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-400">
              Pinned references
            </p>
            <span className="text-[10px] text-gray-400">{pinnedStructureDefs.length}</span>
          </div>
          <div className="flex flex-1 flex-col justify-end overflow-y-auto px-4 py-3 gap-3">
            {pinnedStructureDefs.map((def) => {
              const l1 = learnerModel?.nativeLanguage
                ? def.l1Interference[learnerModel.nativeLanguage] ?? null
                : null;
              const lessonId = getLessonForStructure(def.id);
              return (
                <div
                  key={def.id}
                  className="rounded-xl border border-line bg-paper-warm p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{def.name}</p>
                      <p className="text-[11px] text-gray-500">{def.cefrLevel}</p>
                    </div>
                    <button
                      onClick={() => unpinStructure(def.id)}
                      aria-label={`Unpin ${def.name}`}
                      title="Unpin"
                      className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  {def.whyThisHappens ? (
                    <p className="text-[12px] leading-snug text-gray-700">{def.whyThisHappens}</p>
                  ) : (
                    <p className="text-[12px] leading-snug text-gray-700">{def.description}</p>
                  )}
                  {def.grammarTable && (
                    <GrammarTable table={def.grammarTable} mode="compact" />
                  )}
                  {l1 && (
                    <div className="rounded-lg border border-gray-100 bg-paper px-2.5 py-2">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-0.5">
                        In your language
                      </p>
                      <p className="text-[11px] leading-snug italic text-gray-600">{l1}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => router.push(`/study/${encodeURIComponent(def.id)}`)}
                      className="rounded-lg border border-line-2 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => {
                        if (lessonId) router.push(`/chat?lesson=${lessonId}`);
                      }}
                      disabled={!lessonId}
                      className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      Focus lesson
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Conversation column */}
      <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-lg space-y-5">
          {/* Today's focus — calm, honest opener.
              The full daily-warm-up landing (heatmap + weekly progress) is a
              brief Day 6-7 deferral that lives on `/`, not here. */}
          {turns.length === 0 && opener && (
            <div className="rounded-xl border border-line bg-paper-warm p-5 shadow-sm">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
                Today&apos;s focus
              </p>
              <p className="mt-2 font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
                {dailyPromptFocus
                  ? <>Start with <span className="bg-warm-bg px-1.5 py-0.5 rounded">{dailyPromptFocus}</span>.</>
                  : "Start anywhere you'd like."}
              </p>
              <p className="mt-1 text-xs text-mute">
                {priorSessionCount > 0
                  ? `Picks up from your last ${priorSessionCount === 1 ? "session" : `${priorSessionCount} sessions`}.`
                  : "Your first session — say anything to begin."}
              </p>
              {topicRecs.length > 1 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {topicRecs.slice(1, 4).map((rec) => (
                    <button
                      key={rec.structureId}
                      onClick={() => router.push(`/study/${encodeURIComponent(rec.structureId)}`)}
                      className="rounded-full bg-paper px-2.5 py-1 text-[11px] text-ink-2 ring-1 ring-line-2 transition-colors hover:bg-line-2"
                      title={`${rec.reason} — open study card`}
                    >
                      {rec.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Session opener */}
          {opener && (
            <div className="fade-in-up">
              <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                {opener}
              </div>
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
                {/* Score + response text */}
                <div className="flex gap-3">
                  <div className="score-pop">
                    <ScoreRing score={turn.result.score} size={44} />
                  </div>
                  <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                    <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                      __html: safeMarkdown(turn.result.responseText)
                    }} />
                  </div>
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
                {i === turns.length - 1 && turn.result.ruleCard && (() => {
                  const ruleStaticDef = GRAMMAR_STRUCTURES.find(
                    (s) => s.id === turn.result.ruleCard?.structureId
                  );
                  const ruleStructureId = turn.result.ruleCard.structureId;
                  const isPinned = pinnedStructureIds.includes(ruleStructureId);
                  return (
                    <div className="rule-card-enter rounded-xl border border-line bg-paper-warm p-5">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                          {turn.result.ruleCard.structureName}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => togglePinStructure(ruleStructureId)}
                            aria-label={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
                            title={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
                            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition-colors ${
                              isPinned
                                ? "bg-gray-900 text-white ring-gray-900 hover:bg-gray-800"
                                : "bg-white text-gray-500 ring-line-2 hover:bg-gray-50 hover:text-gray-700"
                            }`}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 17v5" />
                              <path d="M9 10.76V6h6v4.76l3 3V17H6v-3.24l3-3z" />
                            </svg>
                            {isPinned ? "Pinned" : "Pin"}
                          </button>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-400 ring-1 ring-line-2">
                            inline
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-gray-700">{turn.result.ruleCard.rule}</p>
                      {turn.result.ruleCard.l1Comparison && (
                        <p className="mt-2 text-sm text-gray-500 italic">
                          {turn.result.ruleCard.l1Comparison}
                        </p>
                      )}
                      <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-mono text-gray-600 ring-1 ring-line-2">
                        {turn.result.ruleCard.example}
                      </p>
                      {ruleStaticDef?.grammarTable && (
                        <div className="mt-3">
                          <GrammarTable table={ruleStaticDef.grammarTable} mode="compact" />
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Token-level rule cards (latest turn, no explicit card) */}
                {i === turns.length - 1 && !turn.result.ruleCard && ruleTokens.length > 0 && (
                  <div className="space-y-2">
                    {ruleTokens.map((token, j) => (
                      <RuleCard key={j} token={token} index={j} />
                    ))}
                  </div>
                )}

                {/* Deep practice nudge has moved to the bottom of the right rail. */}

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
                  <div className="fade-in-up">
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
                      <p className="text-sm text-gray-600">{turn.result.nextPrompt}</p>
                    </div>
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
                  <ThinkingMark label="Checking..." />
                </div>
              )}
            </div>
          )}

          {/* Loading (only when no streaming text yet and no sentence) */}
          {loading && !streamingSentence && (
            <div className="fade-in-up">
              <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-400 ring-1 ring-gray-100">
                <ThinkingMark label="Thinking..." />
              </div>
            </div>
          )}

          {/* Pending voice bubbles — live transcript while user speaks, and
              streaming coach text while coach is replying. Cleared once the
              tool returns a finalized analysis (which appends to turns). */}
          {voiceConnected && pendingTranscript && (
            <div className="flex justify-end fade-in-up">
              <div className="max-w-sm rounded-2xl rounded-br-md bg-gray-900/80 px-4 py-3 text-sm text-white">
                {pendingTranscript}
                <span className="ml-1 inline-block h-3.5 w-1 animate-pulse bg-white/60 align-text-bottom" />
              </div>
            </div>
          )}
          {voiceConnected && pendingModelText && realtime.state === "speaking" && (
            <div className="fade-in-up flex gap-3">
              <div className="w-[44px]" />
              <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                <div className="whitespace-pre-wrap">{pendingModelText}</div>
                <span className="inline-block h-4 w-1.5 animate-pulse bg-gray-400 align-text-bottom ml-0.5" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar — realtime voice mic when supported, speech-to-text fallback
          otherwise, plus text + send. */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-3">
        {voiceConnected && (
          <div className="mx-auto mb-2 flex max-w-lg items-center justify-center gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium ${
                realtime.state === "listening"
                  ? "bg-emerald-100 text-emerald-700"
                  : realtime.state === "speaking"
                    ? "bg-blue-100 text-blue-700"
                    : realtime.state === "thinking"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  realtime.state === "listening"
                    ? "bg-emerald-600 animate-pulse"
                    : realtime.state === "speaking"
                      ? "bg-blue-600 animate-pulse"
                      : realtime.state === "thinking"
                        ? "bg-amber-600 animate-pulse"
                        : "bg-gray-400"
                }`}
              />
              {realtime.state === "connecting" && "Connecting…"}
              {realtime.state === "listening" && "Listening"}
              {realtime.state === "speaking" && "Speaking"}
              {realtime.state === "thinking" && "Analyzing"}
            </span>
            <button
              onClick={() => realtime.disconnect()}
              className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-200"
            >
              End voice
            </button>
          </div>
        )}
        <div className="mx-auto flex max-w-lg gap-2">
          {realtime.isSupported ? (
            <button
              onClick={toggleVoice}
              disabled={loading || speaking || realtime.state === "connecting"}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all ${
                voiceConnected
                  ? "bg-red-500 text-white shadow-lg shadow-red-200"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              } disabled:cursor-not-allowed disabled:opacity-40`}
              title={voiceConnected ? "End realtime voice" : "Start realtime voice"}
              aria-label={voiceConnected ? "End realtime voice" : "Start realtime voice"}
            >
              {voiceConnected ? (
                <div className="relative">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-white animate-ping" />
                </div>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          ) : (
            <SpeechButton
              onResult={handleSpeechResult}
              onInterim={(text) => setInput(text)}
              onListeningChange={handleListeningChange}
              disabled={loading || speaking || voiceConnected}
            />
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={voiceConnected ? "Voice mode active — speak or type" : "Write or speak a German sentence..."}
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

      {/* Right sidebar — vocab, activity, grammar rules, weak areas. The
          deep-practice nudge is anchored at the bottom so it aligns with the
          chat input rather than scrolling away inline. */}
      <aside
        className={`hidden lg:flex shrink-0 flex-col border-l border-gray-200 bg-white transition-[width] duration-200 ${
          rightRailCollapsed ? "w-10" : "w-80"
        }`}
      >
        <div className="flex items-center justify-end px-2 pt-3 shrink-0">
          <button
            onClick={() => setRightRailCollapsed((v) => !v)}
            aria-label={rightRailCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {rightRailCollapsed ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
            </svg>
          </button>
        </div>
        {!rightRailCollapsed && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {/* Vocabulary — today's deck pulse */}
          <VocabCard />

          {/* Activity — week progress + 14-week heatmap */}
          <ActivityCard />

          {/* Current turn analysis — keep the live tutor diagnosis visible in
              the right rail, matching the older quick-practice feel. */}
          {lastResult && (
            <div className="rounded-xl border border-line bg-paper-warm p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Current analysis
                </p>
                <ScoreRing score={lastResult.score} size={36} />
              </div>

              {currentAnalysisCorrections.length > 0 ? (
                <div className="space-y-2">
                  {currentAnalysisCorrections.slice(0, 3).map((correction, idx) => (
                    <div key={`${correction.original}-${idx}`} className="rounded-lg bg-white px-3 py-2 text-[11px] ring-1 ring-line-2">
                      <div className="text-red-500 line-through">{correction.original}</div>
                      <div className="font-medium text-green-700">{correction.correction}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-white px-3 py-2 text-[12px] text-gray-600 ring-1 ring-line-2">
                  No correction needed on the latest turn.
                </p>
              )}

              {(latestRuleForSidebar || latestRuleCardForSidebar) && (() => {
                const structureId =
                  latestRuleCardForSidebar?.structureId ??
                  latestRuleForSidebar?.structureId ??
                  null;
                const title =
                  latestRuleCardForSidebar?.structureName ??
                  latestRuleForSidebar?.structureName ??
                  "Grammar focus";
                const description =
                  latestRuleCardForSidebar?.rule ??
                  latestRuleForSidebar?.description ??
                  "";
                const isPinned = !!structureId && pinnedStructureIds.includes(structureId);

                return (
                  <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-line-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-gray-800">{title}</p>
                        {description && (
                          <p className="mt-1 text-[11px] leading-snug text-gray-600">{description}</p>
                        )}
                      </div>
                      {structureId && (
                        <button
                          onClick={() => togglePinStructure(structureId)}
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition-colors ${
                            isPinned
                              ? "bg-gray-900 text-white ring-gray-900"
                              : "bg-gray-50 text-gray-500 ring-line-2 hover:bg-gray-100"
                          }`}
                        >
                          {isPinned ? "Pinned" : "Pin"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Mistake of the day */}
          {mistakeOfTheDay && (
            <div className="rounded-xl border border-line bg-paper-warm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Mistake of the day
                </p>
                <span className="text-[10px] text-gray-400">
                  {mistakeOfTheDay.count}x
                </span>
              </div>
              <div className="space-y-1.5 text-[12px] leading-relaxed">
                <div className="text-red-500 line-through">{mistakeOfTheDay.example}</div>
                <div className="font-medium text-green-700">{mistakeOfTheDay.correction}</div>
              </div>
              <p className="text-[11px] leading-snug text-gray-500">
                {mistakeStructure?.name ?? mistakeOfTheDay.pattern} · {formatRecency(mistakeOfTheDay.lastSeen)}
              </p>
              {mistakeStructure && (
                <button
                  onClick={() => {
                    const lessonId = getLessonForStructure(mistakeStructure.id);
                    if (lessonId) router.push(`/chat?lesson=${lessonId}`);
                  }}
                  className="w-full rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-gray-800"
                >
                  Drill 30 seconds
                </button>
              )}
            </div>
          )}

          {/* Reference card and active-rule card now live in the left rail. */}

          {/* Cross-session alerts */}
          {persistentAlerts.filter((a) => a.severity === "intervention").length > 0 && !mistakeOfTheDay && (
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

          {/* Focus areas moved to the sticky bottom group, beneath the chat
              input — easier to glance at while practising. */}

          {/* Top mistakes */}
          {topMistakes.length > 1 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-2">
                {topMistakes.length - 1} more to review
              </p>
              <div className="space-y-2">
                {topMistakes.slice(1, 4).map((err) => (
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
        )}
        {!rightRailCollapsed && (weakList.length > 0 || latestDeepPracticeNudge) && (
          <div className="shrink-0 border-t border-gray-200 bg-gray-50">
            {weakList.length > 0 && (
              <div className="border-b border-gray-200 px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Focus areas
                </p>
                <div className="space-y-1.5">
                  {weakList.map((s) => (
                    <div key={s.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-600 truncate">{s.name}</span>
                        <span className="text-[10px] text-gray-400">{Math.round(s.mastery * 100)}%</span>
                      </div>
                      <div className="h-0.5 w-full rounded-full bg-gray-200">
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
            {latestDeepPracticeNudge && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Your tutor recommends
                </p>
                <p className="text-[12px] leading-snug text-gray-700">
                  {latestDeepPracticeNudge.message}
                </p>
                <button
                  onClick={() => router.push(`/chat?lesson=${latestDeepPracticeNudge.lessonId}`)}
                  className="w-full rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-semibold text-white hover:bg-gray-800 transition-colors"
                >
                  Start focused practice
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      </div>{/* end main flex area */}
    </div>
  );
}

export default function Home() {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-gray-50"><p className="text-sm text-gray-400">Loading…</p></div>}>
        <HomeContent />
      </Suspense>
    </AuthGuard>
  );
}
