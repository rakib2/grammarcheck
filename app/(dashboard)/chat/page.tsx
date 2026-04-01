"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import GrammarCorrection from "@/components/GrammarCorrection";
import ScoreRing from "@/components/ScoreRing";
import RuleCard from "@/components/RuleCard";
import SpeechButton from "@/components/SpeechButton";
import PhaseIndicator from "@/components/PhaseIndicator";
import LessonComplete from "@/components/LessonComplete";
import { GrammarAnalysis, LessonPhase, CurriculumLesson, Token, LearnerModel } from "@/types";
import { getLessonById, getNextLesson } from "@/lib/curriculum";
import {
  getTeachMessages,
  getDrillPrompt,
  getWritePrompt,
  getReviewIntro,
  getNextPhase,
  calculateDrillScore,
} from "@/lib/lessonEngine";

const STORAGE_KEY = "grammarcoach_learner_model";

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

/** Sync a lesson score back into the shared learnerModel */
function syncLessonScore(lessonId: string, structureId: string | null, score: number) {
  const model = loadModel();
  if (!model || !structureId) return;

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
  saveModel(model);
}

const FREE_TOPICS = ["Akkusativ", "Dativ", "Adjektiv", "Genitiv", "Free practice"];

type Message =
  | { role: "coach"; type: "text"; text: string }
  | { role: "coach"; type: "analysis"; text: string; analysis: GrammarAnalysis }
  | { role: "coach"; type: "complete"; lesson: CurriculumLesson; drillScore: number; writeScore: number; passed: boolean; nextLesson?: CurriculumLesson }
  | { role: "user"; type: "text"; text: string };

function ChatPageContent() {
  const searchParams = useSearchParams();
  const lessonId = searchParams.get("lesson");
  const topicParam = searchParams.get("topic");

  // Lesson mode state
  const lesson = lessonId ? getLessonById(lessonId) : null;
  const [phase, setPhase] = useState<LessonPhase>("teach");
  const [drillIndex, setDrillIndex] = useState(0);
  const [drillResults, setDrillResults] = useState<{ correct: boolean }[]>([]);
  const [drillScore, setDrillScore] = useState<number | null>(null);
  const [writeScore, setWriteScore] = useState<number | null>(null);
  const [teachSent, setTeachSent] = useState(false);

  // Free practice state
  const [activeTopic, setActiveTopic] = useState("Akkusativ");
  const [nativeLanguage, setNativeLanguage] = useState<string | null>(null);
  const [awaitingLanguage, setAwaitingLanguage] = useState(false);

  // Shared state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const initializeSession = useCallback(() => {
    // Try to load native language from learner model
    const model = loadModel();
    if (model?.nativeLanguage) {
      setNativeLanguage(model.nativeLanguage);
    }

    if (lesson) {
      const teachMsgs = getTeachMessages(lesson);
      setMessages(teachMsgs.map((t) => ({ role: "coach", type: "text", text: t })));
      setPhase("teach");
      setDrillIndex(0);
      setDrillResults([]);
      setDrillScore(null);
      setWriteScore(null);
      setTeachSent(true);
    } else {
      if (model?.nativeLanguage) {
        // Skip language prompt if we already know it
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
  }, [lesson, activeTopic]);

  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  // ── Lesson mode submit ──
  async function handleLessonSubmit(text: string) {
    if (phase === "teach") {
      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      const firstDrill = getDrillPrompt(lesson!, 0);
      if (firstDrill) {
        setMessages((prev) => [...prev, { role: "coach", type: "text", text: firstDrill }]);
      }
      setPhase("drill");
      setDrillIndex(0);
      return;
    }

    if (phase === "drill") {
      setMessages((prev) => [...prev, { role: "user", type: "text", text }]);
      setLoading(true);

      try {
        const res = await fetch("/api/drill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonId: lesson!.id, drillIndex, answer: text }),
        });
        const result = await res.json();
        const newResults = [...drillResults, { correct: result.correct }];
        setDrillResults(newResults);

        const feedbackText = result.correct
          ? `Correct! ${result.feedback}`
          : `Not quite. ${result.feedback}${result.correctAnswer ? `\nCorrect answer: **${result.correctAnswer}**` : ""}`;

        setMessages((prev) => [...prev, { role: "coach", type: "text", text: feedbackText }]);

        const next = getNextPhase("drill", lesson!, drillIndex);
        if (next.phase === "drill") {
          const nextDrill = getDrillPrompt(lesson!, next.drillIndex);
          if (nextDrill) {
            setMessages((prev) => [...prev, { role: "coach", type: "text", text: nextDrill }]);
          }
          setDrillIndex(next.drillIndex);
        } else {
          const score = calculateDrillScore(newResults);
          setDrillScore(score);
          const writePromptText = getWritePrompt(lesson!);
          setMessages((prev) => [
            ...prev,
            { role: "coach", type: "text", text: `Drills complete! Score: **${score}%**\n\nNow let's practice writing.` },
            { role: "coach", type: "text", text: writePromptText },
          ]);
          setPhase("write");
        }
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

        const finalDrillScore = drillScore ?? 0;
        const avgScore = Math.round((finalDrillScore + analysis.score) / 2);
        const passed = avgScore >= lesson!.passingScore;
        const next = getNextLesson(lesson!.id);

        // Sync score back to shared learner model
        syncLessonScore(lesson!.id, lesson!.grammarFocus, avgScore);

        const reviewText = getReviewIntro(finalDrillScore, analysis.score, passed);
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
    // Auto-submit speech results in write phase and free practice
    if ((lesson && phase === "write") || (!lesson && !awaitingLanguage)) {
      setInput("");
      submitFromSpeech(text.trim());
    } else {
      setInput(text);
    }
  }

  async function submitFromSpeech(text: string) {
    if (!text || loading) return;
    if (lesson) {
      await handleLessonSubmit(text);
    } else {
      await handleFreePracticeSubmit(text);
    }
  }

  const isReviewPhase = lesson && phase === "review";

  // Get rule tokens from last analysis message
  const lastAnalysisMsg = [...messages].reverse().find(
    (m) => m.role === "coach" && m.type === "analysis"
  );
  const ruleTokens: Token[] = lastAnalysisMsg && lastAnalysisMsg.type === "analysis"
    ? lastAnalysisMsg.analysis.tokens.filter((t) => (t.status === "wrong" || t.status === "warn") && (t.correction || t.rule))
    : [];

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
        {lesson && (
          <PhaseIndicator currentPhase={phase} drillScore={drillScore} writeScore={writeScore} />
        )}
      </header>

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
              return (
                <div key={i} className="py-2 fade-in-up">
                  <LessonComplete
                    lesson={msg.lesson}
                    drillScore={msg.drillScore}
                    writeScore={msg.writeScore}
                    passed={msg.passed}
                    nextLesson={msg.nextLesson}
                  />
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
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  <span className="ml-2">Checking&hellip;</span>
                </span>
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
                    : lesson && phase === "write"
                      ? "Write your sentence..."
                      : awaitingLanguage
                        ? "Type your native language..."
                        : "Write a German sentence..."
              }
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || loading}
              className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lesson && phase === "teach" ? "Ready" : lesson && phase === "drill" ? "Answer" : "Check"}
            </button>
          </div>
        </div>
      )}
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
