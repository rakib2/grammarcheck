"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import GrammarCorrection from "@/components/GrammarCorrection";
import ScoreRing from "@/components/ScoreRing";
import RuleCard from "@/components/RuleCard";
import SpeechButton from "@/components/SpeechButton";
import PhaseIndicator from "@/components/PhaseIndicator";
import LessonComplete from "@/components/LessonComplete";
import LessonReference from "@/components/LessonReference";
import ThinkingMark from "@/components/ThinkingMark";
import { GrammarAnalysis, LessonPhase, CurriculumLesson, Token, ErrorPattern, TranslationEvalResult, LearnerModel } from "@/types";
import { getLessonById, getNextLesson } from "@/lib/curriculum";
import { getStructureForLesson } from "@/lib/learningPath";
import { GRAMMAR_STRUCTURES } from "@/lib/grammarStructures";
import { useAuth } from "@/lib/AuthContext";
import { loadLearnerModel, saveLearnerModel } from "@/lib/learnerModelSync";
import {
  getTeachMessages,
  getDrillPrompt,
  getWritePrompt,
  getReviewIntro,
  getNextPhase,
  calculateDrillScore,
  getTranslateIntro,
  getErrorSpotIntro,
  getStoryIntro,
  hasErrorSpotMaterial,
  pickErrorSpotMaterial,
  TRANSLATE_PROMPT_COUNT,
  TRANSLATE_MAX_ATTEMPTS,
  ADAPTIVE_DRILL_MIN_ITEMS,
  ADAPTIVE_DRILL_MAX_ITEMS,
  ADAPTIVE_DRILL_GRADUATION_STREAK,
  buildFallbackFocusedSessionPlan,
  DynamicDrillItem,
  DynamicReferenceExample,
  FocusedTranslatePrompt,
  FocusedSessionPlan,
} from "@/lib/lessonEngine";
import {
  assemblePlanFromPool,
  cacheReferences,
  findBackingPoolItem,
  readReferences,
} from "@/lib/exercisePool";
import {
  countPending,
  ingestBatch,
  loadPoolSlice,
  markServed,
  markSubmitted,
  recentHashes,
  recentSubmissions,
} from "@/lib/exercisePoolSync";
import {
  clearLessonChat,
  loadLessonChat,
  saveLessonChat,
} from "@/lib/lessonChatCache";
import { computeAdaptationHints, recommendNextLesson } from "@/lib/learnerBrain";
import { PooledExercise } from "@/types";

const POOL_MIN_TO_SERVE = 6;
const POOL_REFILL_THRESHOLD = 4;
const POOL_BATCH_SIZE = 8;

/** Sync a lesson score back into the shared learner model.
 *  Supabase-aware: reads/writes via the sync helpers so cross-device state
 *  stays consistent when the learner finishes a focused lesson. */
async function syncLessonScore(
  structureId: string | null,
  score: number,
  userId: string | null
): Promise<void> {
  if (!structureId) return;
  const model = await loadLearnerModel(userId);
  if (!model) return;

  const mastery = score / 100;
  const alpha = 0.3;
  const existing = model.structures.find((s) => s.id === structureId);

  if (existing) {
    existing.mastery = Math.round((existing.mastery * (1 - alpha) + mastery * alpha) * 100) / 100;
    existing.attempts += 1;
    existing.lastSeen = new Date().toISOString();
    existing.lastCorrect = score >= 70;
  } else {
    model.structures.push({
      id: structureId,
      name: structureId,
      cefrLevel: model.detectedLevel,
      mastery: Math.round(mastery * 100) / 100,
      attempts: 1,
      lastSeen: new Date().toISOString(),
      lastCorrect: score >= 70,
    });
  }

  model.updatedAt = new Date().toISOString();
  await saveLearnerModel(model, userId);
}

const FREE_TOPICS = ["Akkusativ", "Dativ", "Adjektiv", "Genitiv", "Free practice"];

type Message =
  | { role: "coach"; type: "text"; text: string }
  | { role: "coach"; type: "analysis"; text: string; analysis: GrammarAnalysis }
  | { role: "coach"; type: "complete"; lesson: CurriculumLesson; drillScore: number; writeScore: number; passed: boolean; nextLesson?: CurriculumLesson }
  | { role: "user"; type: "text"; text: string };

function ChatPageContent() {
  const searchParams = useSearchParams();
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const lessonId = searchParams.get("lesson");
  const topicParam = searchParams.get("topic");
  const routeAttempt = searchParams.get("attempt") ?? searchParams.get("retry") ?? "0";
  const [lessonAttempt, setLessonAttempt] = useState(0);

  // Lesson mode state
  const lesson = lessonId ? getLessonById(lessonId) : null;
  const sessionAttemptKey = lesson ? `${lesson.id}:${routeAttempt}:${lessonAttempt}` : `free:${routeAttempt}:${lessonAttempt}`;
  const [phase, setPhase] = useState<LessonPhase>("teach");
  const [drillIndex, setDrillIndex] = useState(0);
  const [drillResults, setDrillResults] = useState<{ correct: boolean }[]>([]);
  const [drillCorrectStreak, setDrillCorrectStreak] = useState(0);
  const [drillScore, setDrillScore] = useState<number | null>(null);
  const [writeScore, setWriteScore] = useState<number | null>(null);
  const [teachSent, setTeachSent] = useState(false);
  const [sessionPlan, setSessionPlan] = useState<FocusedSessionPlan | null>(null);
  const [sessionPlanLoading, setSessionPlanLoading] = useState(false);
  // Pool items backing the current session plan. Used to (a) close the
  // pool lifecycle by calling markSubmitted on each eval, and (b) look up
  // a backing item's evalKind/evalSpec for local-first grading.
  const [pooledItems, setPooledItems] = useState<PooledExercise[]>([]);

  // Translate phase state — prompts are part of the focused-session blueprint.
  const [translatePrompts, setTranslatePrompts] = useState<FocusedTranslatePrompt[] | null>(null);
  const [translateIdx, setTranslateIdx] = useState(0);
  const [translateAttempts, setTranslateAttempts] = useState(0);
  const [translateResults, setTranslateResults] = useState<{ score: number; correct: boolean }[]>([]);
  const [translateScore, setTranslateScore] = useState<number | null>(null);
  const [translatePromptShown, setTranslatePromptShown] = useState(false);

  // Full learner model — used by the brain layer to compute adaptation
  // hints for the pool generator. Loaded once at session init and used
  // when (re)generating exercise batches.
  const [learnerModel, setLearnerModel] = useState<LearnerModel | null>(null);

  // Error-spot phase state — one buggy sentence pulled from the learner's
  // own past errors against this lesson's structure
  const [errorPatterns, setErrorPatterns] = useState<ErrorPattern[]>([]);
  const [errorSpotMaterial, setErrorSpotMaterial] = useState<ErrorPattern | null>(null);
  const [errorSpotScore, setErrorSpotScore] = useState<number | null>(null);
  const [storyScore, setStoryScore] = useState<number | null>(null);

  const lessonStructureId = lesson ? getStructureForLesson(lesson.id) : null;
  const lessonStructureDef = lessonStructureId
    ? GRAMMAR_STRUCTURES.find((s) => s.id === lessonStructureId) ?? null
    : null;
  const lessonHasErrorSpot = hasErrorSpotMaterial(errorPatterns, lessonStructureId);

  // Free practice state
  const [activeTopic, setActiveTopic] = useState("Akkusativ");
  const [nativeLanguage, setNativeLanguage] = useState<string | null>(null);
  const [awaitingLanguage, setAwaitingLanguage] = useState(false);

  // Shared state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Mobile drawer for the always-visible reference. Desktop (lg+) renders
  // the reference inline as a right rail and ignores this state.
  const [referenceDrawerOpen, setReferenceDrawerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionPlanRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (topicParam && !lesson) {
      const match = FREE_TOPICS.find((t) => t.toLowerCase() === topicParam.toLowerCase());
      if (match) setActiveTopic(match);
    }
  }, [topicParam, lesson]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [messages, loading]);

  const initializeSession = useCallback(async () => {
    // Try to load native language from learner model (Supabase-first if signed in)
    const model = await loadLearnerModel(userIdRef.current);
    setLearnerModel(model ?? null);
    if (model?.nativeLanguage) {
      setNativeLanguage(model.nativeLanguage);
    }
    if (model?.errorPatterns) {
      setErrorPatterns(model.errorPatterns);
    }

    if (lesson) {
      // Check the hot-tier lesson cache first — if a snapshot exists for this
      // exact attemptKey, restore it so a refresh doesn't drop the learner
      // back into the teach phase. New attempts (different lessonAttempt or
      // ?attempt= param) get their own slot, so retries start clean.
      const cached = loadLessonChat(userIdRef.current, sessionAttemptKey);
      if (cached) {
        setPhase(cached.phase);
        setMessages(cached.messages);
        setDrillIndex(cached.drillIndex);
        setDrillResults(cached.drillResults);
        setDrillCorrectStreak(cached.drillCorrectStreak);
        setDrillScore(cached.drillScore);
        setTranslatePrompts(cached.translatePrompts);
        setTranslateIdx(cached.translateIdx);
        setTranslateAttempts(cached.translateAttempts);
        setTranslateResults(cached.translateResults);
        setTranslateScore(cached.translateScore);
        setTranslatePromptShown(cached.translatePromptShown);
        setErrorSpotMaterial(cached.errorSpotMaterial);
        setErrorSpotScore(cached.errorSpotScore);
        setStoryScore(cached.storyScore);
        setWriteScore(cached.writeScore);
        setTeachSent(cached.teachSent);
        setSessionPlan(cached.sessionPlan);
        setPooledItems(cached.pooledItems);
        setSessionPlanLoading(false);
        // Mark plan-fetch as already-resolved for this attempt so the
        // pool-loading useEffect doesn't refetch + clobber restored state.
        sessionPlanRequestKeyRef.current = sessionAttemptKey;
        return;
      }

      const teachMsgs = getTeachMessages(lesson);
      setMessages(teachMsgs.map((t) => ({ role: "coach", type: "text", text: t })));
      setPhase("teach");
      setDrillIndex(0);
      setDrillResults([]);
      setDrillCorrectStreak(0);
      setDrillScore(null);
      setWriteScore(null);
      setTeachSent(true);
      const fallbackPlan = buildFallbackFocusedSessionPlan(lesson);
      setSessionPlan(fallbackPlan);
      setSessionPlanLoading(false);
      setPooledItems([]);
      sessionPlanRequestKeyRef.current = null;
      // Reset new-phase state for a fresh lesson run
      setTranslatePrompts(fallbackPlan.translatePrompts);
      setTranslateIdx(0);
      setTranslateAttempts(0);
      setTranslateResults([]);
      setTranslateScore(null);
      setTranslatePromptShown(false);
      setErrorSpotMaterial(null);
      setErrorSpotScore(null);
      setStoryScore(null);
    } else {
      if (model?.nativeLanguage) {
        setAwaitingLanguage(false);
        setMessages([{
          role: "coach",
          type: "text",
          text: `Topic: **${activeTopic}**. Write a German sentence and I'll check it.`,
        }]);
      } else {
        setMessages([{
          role: "coach",
          type: "text",
          text: "What is your native language? (e.g. English, Turkish, Bengali...)",
        }]);
        setAwaitingLanguage(true);
      }
    }
  }, [lesson, activeTopic, sessionAttemptKey]);

  useEffect(() => {
    if (!lesson || sessionPlanLoading) return;
    const requestKey = sessionAttemptKey;
    if (sessionPlanRequestKeyRef.current === requestKey) return;
    sessionPlanRequestKeyRef.current = requestKey;
    let cancelled = false;

    // Pool-first flow: read instantly from the per-user exercise pool. Only
    // block on Claude when the pool is empty (cold start). Refill in the
    // background when the served slice leaves the pool below threshold.
    //
    // The chat page still consumes a `FocusedSessionPlan` — the pool is
    // adapted into that shape. References still come from the fallback
    // builder until we add a 'reference' kind to the pool.
    const fallbackPlan = buildFallbackFocusedSessionPlan(lesson);
    const filteredErrors = errorPatterns.filter((e) => e.structureId === lessonStructureId);

    setSessionPlanLoading(true);

    async function runRefill(
      excludeHashes: string[],
      adaptation: ReturnType<typeof computeAdaptationHints> | null
    ): Promise<{ items: PooledExercise[]; referenceExamples: DynamicReferenceExample[] }> {
      try {
        const res = await fetch("/api/lesson/pool/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonId: lesson!.id,
            nativeLanguage,
            errorPatterns: filteredErrors,
            batchSize: POOL_BATCH_SIZE,
            excludeHashes,
            adaptation,
          }),
        });
        if (!res.ok) return { items: [], referenceExamples: [] };
        const data = (await res.json()) as {
          items?: PooledExercise[];
          referenceExamples?: DynamicReferenceExample[];
        };
        const items = data.items ?? [];
        const referenceExamples = data.referenceExamples ?? [];
        if (items.length === 0) return { items: [], referenceExamples };
        await ingestBatch(userIdRef.current, lesson!.id, "drill", items);
        return { items, referenceExamples };
      } catch {
        return { items: [], referenceExamples: [] };
      }
    }

    (async () => {
      // 1. Try the pool — instant if anything is cached.
      let slice = await loadPoolSlice(userIdRef.current, lesson.id, "drill", POOL_BATCH_SIZE);
      // The pool stores all kinds together; we asked for 'drill' but need
      // translate/story too. Pull those in parallel.
      const [translateSlice, storySlice] = await Promise.all([
        loadPoolSlice(userIdRef.current, lesson.id, "translate", POOL_BATCH_SIZE),
        loadPoolSlice(userIdRef.current, lesson.id, "story", POOL_BATCH_SIZE),
      ]);
      let combined: PooledExercise[] = [...slice, ...translateSlice, ...storySlice];
      // Reference examples ride alongside the batch (not in the pool table —
      // they have no eval/lifecycle). On warm-start, read the last cached
      // set via lib/exercisePool so the rail doesn't fall back to the
      // hardcoded `buildFallbackFocusedSessionPlan` examples. Cold-start
      // generation will overwrite this cache further down.
      let freshReferenceExamples: DynamicReferenceExample[] =
        readReferences(lesson.id) ?? [];

      // Brain layer: read recent submissions and compute adaptation hints
      // (difficulty band, mode mix, dependent-weak structures). The pool
      // generator uses these to shape Claude's prompt. Computed once per
      // session and reused for any background refill.
      const recentScores = await recentSubmissions(userIdRef.current, lesson.id, 20);
      const adaptation = computeAdaptationHints(learnerModel, lesson.id, recentScores);

      // 2. Cold-start: if the pool is too thin, generate a fresh batch
      // synchronously. This is the only path that blocks on Claude.
      if (combined.length < POOL_MIN_TO_SERVE) {
        const excluded = await recentHashes(userIdRef.current, lesson.id, "drill", 50);
        const fresh = await runRefill(excluded, adaptation);
        if (cancelled) return;
        if (fresh.items.length > 0) combined = [...combined, ...fresh.items];
        if (fresh.referenceExamples.length > 0) {
          freshReferenceExamples = fresh.referenceExamples;
          cacheReferences(lesson.id, fresh.referenceExamples);
        }
      }

      // 3. Last-resort safety net: if even cold-start didn't produce items,
      // fall through to the legacy session endpoint, which has its own
      // hand-built fallback. Preserves existing behaviour for the worst case.
      if (combined.length === 0) {
        try {
          const res = await fetch("/api/lesson/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lessonId: lesson.id,
              attemptKey: sessionAttemptKey,
              nativeLanguage,
              errorPatterns: filteredErrors,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as FocusedSessionPlan;
            if (cancelled) return;
            setSessionPlan(data);
            setTranslatePrompts(data.translatePrompts?.length ? data.translatePrompts : fallbackPlan.translatePrompts);
            // Reference examples now live in the always-visible right rail
            // via sessionPlan.referenceExamples — no duplicate chat message.
            setSessionPlanLoading(false);
            return;
          }
        } catch {
          /* fall through to fallback below */
        }
        if (!cancelled) {
          setSessionPlan(fallbackPlan);
          setTranslatePrompts(fallbackPlan.translatePrompts);
          setSessionPlanLoading(false);
        }
        return;
      }

      // 4. Assemble the FocusedSessionPlan from pooled items + mark them served.
      const plan = assemblePlanFromPool(combined, fallbackPlan, {
        maxDrills: ADAPTIVE_DRILL_MAX_ITEMS,
        maxTranslate: TRANSLATE_PROMPT_COUNT,
      });
      // ALWAYS set referenceExamples from the cached/fresh pool generation —
      // never let the static `buildFallbackFocusedSessionPlan` placeholders
      // ("Ich lerne jeden Tag…") leak through. If we have nothing, show no
      // Live examples block at all rather than misleading ones.
      plan.referenceExamples = freshReferenceExamples;
      if (cancelled) return;
      setSessionPlan(plan);
      setTranslatePrompts(plan.translatePrompts);
      // Keep a reference to the pooled items so submit-time can find the
      // backing row (for markSubmitted + local eval dispatch).
      setPooledItems(combined);

      // Mark the items we actually served as 'served' (fire-and-forget).
      const servedNow = combined.filter((e) =>
        e.kind === "drill"
          ? plan.drillItems.some((d) => d.prompt === e.payload.prompt)
          : e.kind === "translate"
          ? plan.translatePrompts.some((t) => t.english === e.payload.english)
          : e.kind === "story"
          ? plan.storySetup === e.payload.scenario || plan.storySetup === e.payload.prompt
          : false
      );
      void Promise.all(
        servedNow.map((it) =>
          markServed(userIdRef.current, it.id, lesson.id, it.kind)
        )
      );

      // 5. Background refill — fired for either reason:
      //    a) the remaining pool is below threshold (top up exercises), OR
      //    b) we don't have references for the rail yet (user upgraded from
      //       a pre-cache build, or first visit on this device for this topic).
      // Either way the user already has the served batch in front of them;
      // this work is purely background. When references arrive we both cache
      // them and patch the live sessionPlan so the rail updates without a
      // refresh.
      const remaining = await countPending(userIdRef.current, lesson.id, "drill");
      const needsReferences = freshReferenceExamples.length === 0;
      if (!cancelled && (remaining < POOL_REFILL_THRESHOLD || needsReferences)) {
        const excluded = await recentHashes(userIdRef.current, lesson.id, "drill", 50);
        const lessonId = lesson.id;
        void runRefill(excluded, adaptation).then((fresh) => {
          if (cancelled) return;
          if (fresh.referenceExamples.length > 0) {
            cacheReferences(lessonId, fresh.referenceExamples);
            setSessionPlan((current) =>
              current ? { ...current, referenceExamples: fresh.referenceExamples } : current
            );
          }
        });
      }

      setSessionPlanLoading(false);
    })().catch(() => {
      if (!cancelled) {
        setSessionPlan((current) => current ?? fallbackPlan);
        setTranslatePrompts((current) => current ?? fallbackPlan.translatePrompts);
        setSessionPlanLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [lesson, sessionPlan, sessionPlanLoading, nativeLanguage, errorPatterns, learnerModel, lessonStructureId, phase, sessionAttemptKey]);

  useEffect(() => {
    if (auth.loading) return;
    initializeSession();
  }, [initializeSession, auth.loading, userId]);

  // Persist the in-flight lesson on every meaningful state change so a refresh
  // restores the learner exactly where they were. Clear the slot once the
  // lesson reaches review — at that point the durable score is already in
  // Supabase via syncLessonScore.
  useEffect(() => {
    if (!lesson) return;
    if (phase === "review") {
      clearLessonChat(userIdRef.current, sessionAttemptKey);
      return;
    }
    if (messages.length === 0) return;
    saveLessonChat(userIdRef.current, sessionAttemptKey, {
      phase,
      messages,
      drillIndex,
      drillResults,
      drillCorrectStreak,
      drillScore,
      translatePrompts,
      translateIdx,
      translateAttempts,
      translateResults,
      translateScore,
      translatePromptShown,
      errorSpotMaterial,
      errorSpotScore,
      storyScore,
      writeScore,
      teachSent,
      sessionPlan,
      pooledItems,
    });
  }, [
    lesson,
    sessionAttemptKey,
    phase,
    messages,
    drillIndex,
    drillResults,
    drillCorrectStreak,
    drillScore,
    translatePrompts,
    translateIdx,
    translateAttempts,
    translateResults,
    translateScore,
    translatePromptShown,
    errorSpotMaterial,
    errorSpotScore,
    storyScore,
    writeScore,
    teachSent,
    sessionPlan,
    pooledItems,
  ]);

  useEffect(() => {
    if (!lesson || phase !== "translate") return;
    if (translatePromptShown || !translatePrompts || translatePrompts.length === 0) return;
    const first = translatePrompts[0];
    setMessages((prev) => [
      ...prev,
      {
        role: "coach",
        type: "text",
        text: `🌉 **Translate 1/${TRANSLATE_PROMPT_COUNT}**\n\n_${first.english}_\n\n**Hints:** ${first.hints.join(" · ")}`,
      },
    ]);
    setTranslatePromptShown(true);
  }, [lesson, phase, translatePrompts, translatePromptShown]);

  // Pick error-spot material once when entering the phase.
  useEffect(() => {
    if (!lesson || phase !== "error_spot") return;
    if (errorSpotMaterial) return;
    if (!lessonStructureId) return;
    const material = pickErrorSpotMaterial(errorPatterns, lessonStructureId);
    if (!material) {
      // Defensive: shouldn't happen because getNextPhase only routes here
      // when hasErrorSpotMaterial returned true, but skip cleanly if it does
      setPhase("review");
      return;
    }
    setErrorSpotMaterial(material);
    setMessages((prev) => [
      ...prev,
      {
        role: "coach",
        type: "text",
        text: `${getErrorSpotIntro()}\n\n_${material.example}_`,
      },
    ]);
  }, [lesson, phase, errorSpotMaterial, lessonStructureId, errorPatterns]);

  // ── Lesson mode submit ──
  function formatDrillPrompt(item: DynamicDrillItem, idx: number, total: number): string {
    const labels: Record<DynamicDrillItem["mode"], string> = {
      recognize: "Notice",
      complete: "Complete",
      transform: "Transform",
      produce: "Produce",
      recall: "Recall",
      story: "Mini story",
    };
    return `🎯 **${labels[item.mode]} ${idx + 1}/${total}**\n\n${item.prompt}${
      item.hint ? `\n\n_Hint: ${item.hint}_` : ""
    }`;
  }

  function getCurrentDrillItem(idx: number): DynamicDrillItem {
    const dynamic = sessionPlan?.drillItems?.[idx];
    if (dynamic) return dynamic;
    const prompt = getDrillPrompt(lesson!, idx)?.replace(/^🎯 \*\*Drill \d+\/\d+\*\*\n\n/, "") ??
      lesson!.drillPrompts[Math.min(idx, lesson!.drillPrompts.length - 1)] ??
      lesson!.writePrompt;
    return {
      mode: idx < 2 ? "complete" : "produce",
      prompt,
      expectedAnswer: "",
      hint: lesson!.grammarFocus,
      targetSkill: lesson!.grammarFocus,
    };
  }

  function shouldFinishAdaptiveDrills(
    results: { correct: boolean }[],
    streak: number,
    available: number
  ): boolean {
    if (results.length < ADAPTIVE_DRILL_MIN_ITEMS) return false;
    if (streak >= ADAPTIVE_DRILL_GRADUATION_STREAK) return true;
    if (results.length >= Math.min(ADAPTIVE_DRILL_MAX_ITEMS, available)) return true;
    return false;
  }

  function normalizeAnswer(value: string): string {
    return value
      .toLowerCase()
      .replace(/[.,!?;:"'()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function localDrillEval(
    item: DynamicDrillItem,
    answer: string
  ): { correct: boolean; feedback: string; correctAnswer: string } | null {
    if (!item.expectedAnswer.trim()) return null;
    const expected = normalizeAnswer(item.expectedAnswer);
    const actual = normalizeAnswer(answer);
    if (!expected || !actual) return null;

    if (actual === expected) {
      return {
        correct: true,
        feedback: "That matches the target form.",
        correctAnswer: item.expectedAnswer,
      };
    }

    // Recognition / fill-in / short transformation items should be instant.
    // Open production stays with AI evaluation because many answers can be valid.
    if (item.mode === "recognize" || item.mode === "complete" || item.mode === "transform") {
      return {
        correct: false,
        feedback: `The target form here is **${item.expectedAnswer}**.`,
        correctAnswer: item.expectedAnswer,
      };
    }

    return null;
  }

  async function handleLessonSubmit(text: string) {
    if (phase === "teach") {
      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      const available = sessionPlan?.drillItems.length || lesson!.drillPrompts.length || ADAPTIVE_DRILL_MIN_ITEMS;
      const firstDrill = getCurrentDrillItem(0);
      setMessages((prev) => [...prev, { role: "coach", type: "text", text: formatDrillPrompt(firstDrill, 0, available) }]);
      setPhase("drill");
      setDrillIndex(0);
      return;
    }

    if (phase === "drill") {
      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      setLoading(true);

      try {
        const currentDrill = getCurrentDrillItem(drillIndex);
        const available = sessionPlan?.drillItems.length || lesson!.drillPrompts.length || ADAPTIVE_DRILL_MIN_ITEMS;
        const localResult = localDrillEval(currentDrill, text);
        const result = localResult ?? await fetch("/api/drill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonId: lesson!.id,
            drillIndex,
            drillPrompt: currentDrill.prompt,
            expectedAnswer: currentDrill.expectedAnswer,
            targetSkill: currentDrill.targetSkill,
            answer: text,
          }),
        }).then((res) => res.json());
        const newResults = [...drillResults, { correct: result.correct }];
        setDrillResults(newResults);
        const newStreak = result.correct ? drillCorrectStreak + 1 : 0;
        setDrillCorrectStreak(newStreak);

        // Close the pool lifecycle: mark the backing pool row submitted so
        // the table reflects actual consumption (rather than items stuck in
        // 'served' forever). Fire-and-forget — failure is non-fatal.
        const drillPoolItem = findBackingPoolItem(pooledItems, "drill", currentDrill.prompt);
        if (drillPoolItem && lesson) {
          void markSubmitted(
            userIdRef.current,
            drillPoolItem.id,
            lesson.id,
            "drill",
            result.correct ? 1 : 0
          );
        }

        const feedbackText = result.correct
          ? `Correct! ${result.feedback}`
          : `Not quite. ${result.feedback}${result.correctAnswer ? `\nCorrect answer: **${result.correctAnswer}**` : ""}`;

        setMessages((prev) => [...prev, { role: "coach", type: "text", text: feedbackText }]);

        if (!shouldFinishAdaptiveDrills(newResults, newStreak, available)) {
          const nextIdx = drillIndex + 1;
          const nextDrill = getCurrentDrillItem(nextIdx);
          setMessages((prev) => [
            ...prev,
            { role: "coach", type: "text", text: formatDrillPrompt(nextDrill, nextIdx, available) },
          ]);
          setDrillIndex(nextIdx);
        } else {
          // Drills done — drill score logged, on to translate
          const score = calculateDrillScore(newResults);
          setDrillScore(score);
          setMessages((prev) => [
            ...prev,
            {
              role: "coach",
              type: "text",
              text: `Drills complete after **${newResults.length}** questions. Score: **${score}%**${
                newStreak >= ADAPTIVE_DRILL_GRADUATION_STREAK
                  ? `\n\nYou earned an early graduation streak: **${newStreak} correct in a row**.`
                  : ""
              }`,
            },
            { role: "coach", type: "text", text: getTranslateIntro(lesson!) },
          ]);
          if (!translatePrompts || translatePrompts.length === 0) {
            setTranslatePrompts(buildFallbackFocusedSessionPlan(lesson!).translatePrompts);
          }
          setPhase("translate");
          // The translate-prompts useEffect picks up from here
        }
      } catch {
        setMessages((prev) => [...prev, { role: "coach", type: "text", text: "Something went wrong. Try again." }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Translate phase ──
    if (phase === "translate") {
      const availablePrompts =
        translatePrompts && translatePrompts.length > 0
          ? translatePrompts
          : buildFallbackFocusedSessionPlan(lesson!).translatePrompts;
      const current = availablePrompts[translateIdx] ?? availablePrompts[0];
      if (!current) return;

      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      setLoading(true);

      try {
        const res = await fetch("/api/translate/eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonId: lesson!.id,
            english: current.english,
            germanReference: current.germanReference,
            answer: text,
          }),
        });
        const result: TranslationEvalResult = await res.json();
        const score = typeof result.score === "number" ? result.score : 0;
        const correct = !!result.correct;

        // Close the pool lifecycle for this translate prompt.
        const translatePoolItem = findBackingPoolItem(pooledItems, "translate", current.english);
        if (translatePoolItem && lesson) {
          void markSubmitted(
            userIdRef.current,
            translatePoolItem.id,
            lesson.id,
            "translate",
            score / 100
          );
        }

        const issueText = result.issues?.length
          ? `\n\n${result.issues
              .map((issue) =>
                `- ${issue.original ? `**${issue.original}** → ` : ""}**${issue.correction}**: ${issue.explanation}`
              )
              .join("\n")}`
          : "";
        const feedbackText = correct
          ? `✓ ${score}% — ${result.feedback}${issueText}${
              result.nextStep ? `\n\nNext: ${result.nextStep}` : ""
            }`
          : `${score}% — ${result.feedback}${issueText}${
              result.correctAnswer ? `\n\nReference: **${result.correctAnswer}**` : ""
            }${result.nextStep ? `\n\nNext: ${result.nextStep}` : ""}`;
        setMessages((prev) => [...prev, { role: "coach", type: "text", text: feedbackText }]);

        const newAttempts = translateAttempts + 1;
        const shouldAdvance = correct || newAttempts >= TRANSLATE_MAX_ATTEMPTS;

        if (shouldAdvance) {
          // Lock in best score for this prompt: take the displayed score
          const newResults = [...translateResults, { score, correct }];
          setTranslateResults(newResults);

          const nextIdx = translateIdx + 1;
          if (nextIdx < availablePrompts.length) {
            // Move to next prompt with fewer hints (hints fade by 2 per prompt)
            const nextPrompt = availablePrompts[nextIdx];
            const visibleCount = Math.max(0, nextPrompt.hints.length - nextIdx * 2);
            const visibleHints = nextPrompt.hints.slice(0, visibleCount);
            setTranslateIdx(nextIdx);
            setTranslateAttempts(0);
            setMessages((prev) => [
              ...prev,
              {
                role: "coach",
                type: "text",
                text: `🌉 **Translate ${nextIdx + 1}/${TRANSLATE_PROMPT_COUNT}**\n\n_${nextPrompt.english}_${
                  visibleHints.length > 0
                    ? `\n\n**Hints:** ${visibleHints.join(" · ")}`
                    : "\n\n_No hints this time — give it a go on your own._"
                }`,
              },
            ]);
          } else {
            // Last translate prompt done — aggregate score, move on to write
            const avg = Math.round(
              newResults.reduce((sum, r) => sum + r.score, 0) / newResults.length
            );
            setTranslateScore(avg);
            setMessages((prev) => [
              ...prev,
              { role: "coach", type: "text", text: `Translation done. Score: **${avg}%**` },
              { role: "coach", type: "text", text: getStoryIntro(lesson!, sessionPlan?.storySetup) },
            ]);
            setPhase("story");
          }
        } else {
          setTranslateAttempts(newAttempts);
          // Same prompt, hints unchanged — keep encouraging another try
          setMessages((prev) => [
            ...prev,
            {
              role: "coach",
              type: "text",
              text: `Try again — attempt ${newAttempts + 1}/${TRANSLATE_MAX_ATTEMPTS}.`,
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "coach", type: "text", text: "Something went wrong. Try again." },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (phase === "story") {
      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      setLoading(true);
      try {
        const res = await fetch("/api/story/eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonId: lesson!.id,
            storySetup: sessionPlan?.storySetup,
            answer: text,
          }),
        });
        const result = await res.json();
        const score = typeof result.score === "number" ? result.score : 0;
        setStoryScore(score);

        // Close the pool lifecycle for the story item. Story has at most one
        // pooled row per session, matched by the storySetup that drove it.
        const storyKey =
          typeof sessionPlan?.storySetup === "string" ? sessionPlan.storySetup : "";
        const storyPoolItem = storyKey
          ? findBackingPoolItem(pooledItems, "story", storyKey)
          : null;
        if (storyPoolItem && lesson) {
          void markSubmitted(
            userIdRef.current,
            storyPoolItem.id,
            lesson.id,
            "story",
            score / 100
          );
        }

        const feedbackText = `${result.correct ? "✓" : ""} ${score}% — ${result.feedback}${
          !result.correct && result.correctAnswer ? `\n\nModel answer: **${result.correctAnswer}**` : ""
        }`;
        setMessages((prev) => [
          ...prev,
          { role: "coach", type: "text", text: feedbackText },
          { role: "coach", type: "text", text: getWritePrompt(lesson!) },
        ]);
        setPhase("write");
      } catch {
        setMessages((prev) => [...prev, { role: "coach", type: "text", text: "Something went wrong. Try again." }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (phase === "write") {
      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      setLoading(true);

      try {
        const res = await fetch("/api/grammar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sentence: text,
            topic: lesson!.grammarFocus,
            nativeLanguage: nativeLanguage ?? "English",
          }),
        });
        const analysis: GrammarAnalysis = await res.json();
        setWriteScore(analysis.score);

        setMessages((prev) => [
          ...prev,
          { role: "coach", type: "analysis", text: analysis.coachMessage, analysis },
        ]);

        // If this lesson has error-spot material, run it before review
        if (lessonHasErrorSpot) {
          setPhase("error_spot");
          // The error-spot useEffect renders the prompt
          return;
        }

        const finalDrillScore = drillScore ?? 0;
        const scoredParts = [
          finalDrillScore,
          translateScore,
          storyScore,
          analysis.score,
        ].filter((score): score is number => typeof score === "number");
        const avgScore = Math.round(scoredParts.reduce((sum, score) => sum + score, 0) / scoredParts.length);
        const passed = avgScore >= lesson!.passingScore;
        const next = getNextLesson(lesson!.id);

        // Sync score back to shared learner model (Supabase-aware)
        void syncLessonScore(lesson!.grammarFocus, avgScore, userIdRef.current);

        const reviewText =
          getReviewIntro(finalDrillScore, analysis.score, passed) +
          `\n\nSession average across adaptive drill, translation, story, and writing: **${avgScore}%**.`;
        setMessages((prev) => [
          ...prev,
          { role: "coach", type: "text", text: reviewText },
          { role: "coach", type: "complete", lesson: lesson!, drillScore: finalDrillScore, writeScore: analysis.score, passed, nextLesson: next },
        ]);
        setPhase("review");
      } catch {
        setMessages((prev) => [...prev, { role: "coach", type: "text", text: "Something went wrong. Try again." }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Error-spot phase ──
    if (phase === "error_spot") {
      if (!errorSpotMaterial) return;
      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      setLoading(true);
      try {
        // Fast path: if the learner's normalized answer matches the corrected
        // sentence we already know, skip the LLM round-trip. Same trick the
        // translate eval route uses for exact matches. Source of authority is
        // the pool's `evalKind='exact_match'` policy applied inline.
        const normalize = (s: string) =>
          s
            .toLowerCase()
            .replace(/[.,!?;:"'()]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const localMatch =
          normalize(text) === normalize(errorSpotMaterial.correction);
        const result = localMatch
          ? {
              score: 100,
              correct: true,
              feedback: "That matches the corrected form exactly.",
              correctAnswer: errorSpotMaterial.correction,
            }
          : await fetch("/api/error-spot/eval", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lessonId: lesson!.id,
                buggySentence: errorSpotMaterial.example,
                fixedSentence: errorSpotMaterial.correction,
                answer: text,
              }),
            }).then((res) => res.json());
        const score = typeof result.score === "number" ? result.score : 0;
        setErrorSpotScore(score);
        const feedbackText = `${result.correct ? "✓" : ""} ${score}% — ${result.feedback}${
          !result.correct && result.correctAnswer ? `\n\nCorrect: **${result.correctAnswer}**` : ""
        }`;
        setMessages((prev) => [...prev, { role: "coach", type: "text", text: feedbackText }]);

        // Compute final review score and finish the lesson
        const finalDrillScore = drillScore ?? 0;
        const finalWriteScore = writeScore ?? 0;
        const scoredParts = [
          finalDrillScore,
          translateScore,
          storyScore,
          errorSpotScore ?? score,
          finalWriteScore,
        ].filter((part): part is number => typeof part === "number");
        const avgScore = Math.round(scoredParts.reduce((sum, part) => sum + part, 0) / scoredParts.length);
        const passed = avgScore >= lesson!.passingScore;
        const next = getNextLesson(lesson!.id);
        void syncLessonScore(lesson!.grammarFocus, avgScore, userIdRef.current);

        const reviewText =
          getReviewIntro(finalDrillScore, finalWriteScore, passed) +
          `\n\nSession average across adaptive drill, translation, story, recall, and writing: **${avgScore}%**.`;
        setMessages((prev) => [
          ...prev,
          { role: "coach", type: "text", text: reviewText },
          {
            role: "coach",
            type: "complete",
            lesson: lesson!,
            drillScore: finalDrillScore,
            writeScore: finalWriteScore,
            passed,
            nextLesson: next,
          },
        ]);
        setPhase("review");
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "coach", type: "text", text: "Something went wrong. Try again." },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }
  }

  // ── Free practice submit ──
  async function handleFreePracticeSubmit(text: string) {
    if (awaitingLanguage) {
      setNativeLanguage(text);
      setAwaitingLanguage(false);
      setMessages((prev) => [
        ...prev,
        { role: "user", type: "text", text },
        { role: "coach", type: "text", text: `Got it! Topic: **${activeTopic}**. Write a German sentence and I'll check it.` },
      ]);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/grammar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: text,
          topic: activeTopic,
          nativeLanguage: nativeLanguage ?? "English",
        }),
      });
      if (!res.ok) throw new Error("API error");
      const analysis: GrammarAnalysis = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "coach", type: "analysis", text: analysis.coachMessage, analysis },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "coach", type: "text", text: "Something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    if (lesson) {
      await handleLessonSubmit(text);
    } else {
      await handleFreePracticeSubmit(text);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSpeechResult(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    setInput(cleaned);
  }

  function restartFocusedLesson() {
    if (!lesson) return;
    setInput("");
    setLoading(false);
    setLessonAttempt((attempt) => attempt + 1);
  }

  const isReviewPhase = lesson && phase === "review";

  // Get rule tokens from last analysis message
  const lastAnalysisMsg = [...messages].reverse().find(
    (m) => m.role === "coach" && m.type === "analysis"
  );
  const ruleTokens: Token[] = lastAnalysisMsg && lastAnalysisMsg.type === "analysis"
    ? lastAnalysisMsg.analysis.tokens.filter((t) => (t.status === "wrong" || t.status === "warn") && (t.correction || t.rule))
    : [];

  // Whether to render the reference rail/drawer at all. The reference is
  // open-book throughout the lesson — no phase gating. The previous
  // "covered during practice" behaviour has been replaced by always-on
  // reference per the user's preference for open-book learning.
  // Show the rail whenever there's a lesson loaded. Even unmapped lessons
  // (no structureDef) carry rich teachContent that LessonReference renders
  // as a markdown fallback — so the rail is meaningful for every lesson.
  const hasReference = !!lesson;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Topbar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          {lesson ? (
            <>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                {lesson.cefrLevel}
              </span>
              <h1 className="text-sm font-semibold text-gray-800">{lesson.title}</h1>
            </>
          ) : (
            <>
              <h1 className="text-sm font-semibold text-gray-800">Free Practice</h1>
              <div className="flex gap-1">
                {FREE_TOPICS.map((topic) => (
                  <button
                    key={topic}
                    onClick={() => setActiveTopic(topic)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                      activeTopic === topic
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lesson && (
            <a
              href={`/worksheet/${lesson.id}`}
              className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
              title="Open this lesson as a fillable worksheet"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="15" y2="17" />
              </svg>
              Worksheet
            </a>
          )}
          {lesson && (
            <PhaseIndicator
              currentPhase={phase}
              drillScore={drillScore}
              writeScore={writeScore}
              translateScore={translateScore}
              storyScore={storyScore}
              errorSpotScore={errorSpotScore}
              showErrorSpot={lessonHasErrorSpot}
            />
          )}
          {/* Mobile-only drawer trigger — desktop renders the rail inline. */}
          {hasReference && (
            <button
              onClick={() => setReferenceDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 lg:hidden"
              title="Open reference"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              Reference
            </button>
          )}
        </div>
      </header>

      {/* Mobile drawer — slides in from the right when the trigger is tapped.
          Desktop ignores this entirely (the rail below is always rendered). */}
      {hasReference && referenceDrawerOpen && (
        <>
          <div
            onClick={() => setReferenceDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-[85vw] max-w-[380px] flex-col border-l border-line bg-paper shadow-xl lg:hidden">
            <LessonReference
              structureDef={lessonStructureDef}
              lesson={lesson}
              referenceExamples={sessionPlan?.referenceExamples}
              onClose={() => setReferenceDrawerOpen(false)}
            />
          </aside>
        </>
      )}

      {/* Body row: chat column + (lg+) reference rail. */}
      <div className="flex flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-lg space-y-4">
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="flex justify-end fade-in-up">
                  <div className="max-w-sm rounded-2xl rounded-br-md bg-gray-900 px-4 py-3 text-sm text-white">
                    {msg.text}
                  </div>
                </div>
              );
            }

            if (msg.type === "complete") {
              const completeStructureId = lessonStructureId;
              const suggestion = recommendNextLesson(
                learnerModel,
                msg.lesson.id,
                msg.nextLesson?.id ?? null
              );
              return (
                <div key={i} className="py-2 fade-in-up space-y-3">
                  <LessonComplete
                    lesson={msg.lesson}
                    drillScore={msg.drillScore}
                    writeScore={msg.writeScore}
                    passed={msg.passed}
                    nextLesson={msg.nextLesson}
                    onRetry={restartFocusedLesson}
                    focusedAlternative={suggestion.focusedAlternative}
                  />
                  {completeStructureId && (
                    <a
                      href={`/?focus=${encodeURIComponent(completeStructureId)}&voice=1`}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                      </svg>
                      Practice this more with voice
                    </a>
                  )}
                </div>
              );
            }

            if (msg.type === "analysis") {
              return (
                <div key={i} className="space-y-3 fade-in-up">
                  {/* Score + coach message */}
                  <div className="flex gap-3">
                    <div className="score-pop">
                      <ScoreRing score={msg.analysis.score} size={44} />
                    </div>
                    <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                      {msg.analysis.coachMessage}
                    </div>
                  </div>

                  {/* Tokens */}
                  <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
                    <GrammarCorrection
                      tokens={msg.analysis.tokens}
                      score={msg.analysis.score}
                      errorTypes={msg.analysis.errorTypes}
                    />
                  </div>

                  {/* Rule cards for the latest analysis only */}
                  {i === messages.length - 1 && ruleTokens.length > 0 && (
                    <div className="space-y-2">
                      {ruleTokens.map((token, j) => (
                        <RuleCard key={j} token={token} index={j} />
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={i} className="flex gap-3 fade-in-up">
                <div className="flex-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-100">
                  <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                    __html: msg.text
                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                      .replace(/\n/g, '<br/>')
                  }} />
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="fade-in-up">
              <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-400 ring-1 ring-gray-100">
                <ThinkingMark label="Checking…" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      {!isReviewPhase && (
        <div className="border-t border-gray-200 bg-white px-6 py-3">
          <div className="mx-auto flex max-w-lg gap-2">
            <SpeechButton onResult={handleSpeechResult} disabled={loading} />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                lesson && phase === "teach"
                  ? 'Type "ready" to start drills...'
                  : lesson && phase === "drill"
                    ? "Type your answer..."
                    : lesson && phase === "translate"
                      ? "Type your German translation…"
                      : lesson && phase === "write"
                        ? "Write your sentence..."
                        : lesson && phase === "story"
                          ? "Answer the story prompt in German..."
                          : lesson && phase === "error_spot"
                            ? "What's wrong? Type the corrected sentence…"
                            : awaitingLanguage
                              ? "Type your native language..."
                              : "Write a German sentence..."
              }
              rows={1}
              disabled={false}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-200 disabled:bg-gray-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || loading}
              className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lesson && phase === "teach"
                  ? "Ready"
                  : lesson && phase === "drill"
                    ? "Answer"
                    : lesson && phase === "translate"
                      ? "Submit"
                      : lesson && phase === "story"
                        ? "Continue"
                        : lesson && phase === "error_spot"
                          ? "Submit fix"
                          : "Check"}
            </button>
          </div>
        </div>
      )}
      </div>{/* /chat column */}

      {/* Right rail — desktop only. Always visible during the lesson so the
          learner studies open-book; the rail scrolls independently of the chat. */}
      {hasReference && (
        <aside className="hidden w-[340px] shrink-0 border-l border-line bg-paper lg:flex lg:flex-col">
          <LessonReference
            structureDef={lessonStructureDef}
            lesson={lesson}
            referenceExamples={sessionPlan?.referenceExamples}
          />
        </aside>
      )}
      </div>{/* /body row */}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-gray-400">Loading&hellip;</p>
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
