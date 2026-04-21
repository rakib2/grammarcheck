"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CURRICULUM, CEFR_LEVELS } from "@/lib/curriculum";
import { CefrLevel, UserLessonProgress, LearnerModel, ErrorPattern } from "@/types";
import { generateLearningPath, PathItem, getLessonForStructure } from "@/lib/learningPath";
import { useAuth } from "@/lib/AuthContext";
import { loadLearnerModel } from "@/lib/learnerModelSync";
import {
  loadSnapshots,
  loadSummaries,
  getAggregateTrend,
  detectPersistentErrors,
  MasterySnapshot,
  SessionSummary,
  PersistentErrorAlert,
} from "@/lib/sessionMemory";

export default function ProgressPage() {
  const router = useRouter();
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const [progress, setProgress] = useState<Record<string, UserLessonProgress>>({});
  const [learnerModel, setLearnerModel] = useState<LearnerModel | null>(null);
  const [learningPath, setLearningPath] = useState<PathItem[]>([]);
  const [snapshots, setSnapshots] = useState<MasterySnapshot[]>([]);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [persistentAlerts, setPersistentAlerts] = useState<PersistentErrorAlert[]>([]);
  const [streak, setStreak] = useState(0);
  const [xp, setXp] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (auth.loading) return;
      setLoading(true);

      // Source of truth: Supabase for signed-in users, localStorage fallback.
      const model = await loadLearnerModel(userId);
      if (model) {
        setLearnerModel(model);
        setLearningPath(generateLearningPath(model));

        // Load cross-session data
        const snaps = loadSnapshots();
        const sums = loadSummaries();
        setSnapshots(snaps);
        setSummaries(sums);
        setPersistentAlerts(detectPersistentErrors(model, snaps));
      }

      // User progress from Supabase
      const { data: progressRows } = await supabase.from("user_progress").select("*");
      if (progressRows) {
        const map: Record<string, UserLessonProgress> = {};
        for (const row of progressRows) {
          map[row.lesson_id] = {
            id: row.id,
            userId: row.user_id,
            lessonId: row.lesson_id,
            status: row.status,
            phase: row.phase,
            drillScore: row.drill_score,
            writeScore: row.write_score,
            completedAt: row.completed_at,
          };
        }
        setProgress(map);
      }

      // Profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("streak, xp")
        .single();
      if (profile) {
        setStreak(profile.streak ?? 0);
        setXp(profile.xp ?? 0);
      }

      setLoading(false);
    }
    load();
  }, [userId, auth.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCompleted = Object.values(progress).filter((p) => p.status === "completed").length;
  const weakItems = learningPath.filter((p) => p.status === "weak");
  const developingItems = learningPath.filter((p) => p.status === "developing");
  const solidItems = learningPath.filter((p) => p.status === "solid");
  const newItems = learningPath.filter((p) => p.status === "new");

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Overview</h1>
            <p className="text-sm text-gray-500">
              {learnerModel
                ? `${learnerModel.detectedLevel} · ${learnerModel.totalTurns} sentences analyzed`
                : "Structured lessons · CEFR A1–C2"}
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Quick Practice
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Sentences", value: String(learnerModel?.totalTurns ?? 0) },
            { label: "Lessons", value: `${totalCompleted}/${CURRICULUM.length}` },
            { label: "Structures", value: String(learnerModel?.structures.length ?? 0) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{stat.label}</p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Mastery Trend — cross-session progress visualization */}
        {snapshots.length >= 2 && (
          <MasteryTrendChart snapshots={snapshots} />
        )}

        {/* Persistent Error Alerts */}
        {persistentAlerts.filter((a) => a.severity !== "watch").length > 0 && (
          <div className="rounded-xl bg-white p-5 ring-1 ring-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">Persistent Challenges</h2>
            <p className="mb-4 mt-0.5 text-xs text-gray-400">
              These keep coming up across sessions
            </p>
            <div className="space-y-2">
              {persistentAlerts.filter((a) => a.severity !== "watch").map((alert) => {
                const lessonId = getLessonForStructure(alert.structureId);
                return (
                  <div
                    key={alert.structureId}
                    className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                      alert.severity === "intervention"
                        ? "bg-red-50 border border-red-200"
                        : "bg-amber-50 border border-amber-200"
                    }`}
                  >
                    <div>
                      <p className={`text-sm font-medium ${alert.severity === "intervention" ? "text-red-800" : "text-amber-800"}`}>
                        {alert.structureName}
                      </p>
                      <p className={`text-xs ${alert.severity === "intervention" ? "text-red-600" : "text-amber-600"}`}>
                        {alert.totalCount} errors across {alert.sessionsWithError} session{alert.sessionsWithError !== 1 ? "s" : ""}
                      </p>
                    </div>
                    {lessonId && (
                      <button
                        onClick={() => router.push(`/chat?lesson=${lessonId}`)}
                        className="shrink-0 rounded-lg bg-white px-3 py-1 text-[11px] font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                      >
                        Practice
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Session History */}
        {summaries.length > 0 && (
          <div className="rounded-xl bg-white p-5 ring-1 ring-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">Session History</h2>
            <p className="mb-4 mt-0.5 text-xs text-gray-400">
              Your recent practice sessions
            </p>
            <div className="space-y-2">
              {[...summaries].reverse().slice(0, 10).map((s, i) => (
                <div key={i} className="rounded-lg bg-gray-50 px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">Session {s.sessionNumber}</span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(s.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{s.summaryText}</p>
                  <div className="mt-2 flex gap-3 text-[10px] text-gray-400">
                    <span>{s.turnCount} exchanges</span>
                    <span>{s.errorsThisSession} corrected</span>
                    {s.topStrength && <span className="text-green-600">↑ {s.topStrength}</span>}
                    {s.topWeakness && <span className="text-amber-600">↓ {s.topWeakness}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Mistakes — clean overview of error patterns */}
        {learnerModel && learnerModel.errorPatterns.length > 0 && (
          <div className="rounded-xl bg-white p-5 ring-1 ring-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">My Mistakes</h2>
            <p className="mb-4 mt-0.5 text-xs text-gray-400">
              Sorted by frequency — practice the ones that trip you up most
            </p>
            <div className="space-y-1">
              {[...learnerModel.errorPatterns]
                .sort((a, b) => b.count - a.count)
                .map((err) => (
                  <MistakeRow
                    key={err.id}
                    error={err}
                    structure={learnerModel.structures.find((s) => s.id === err.structureId)}
                    onPractice={(lessonId) => router.push(`/chat?lesson=${lessonId}`)}
                  />
                ))}
            </div>
          </div>
        )}

        {/* AI Insights — how the system is adapting */}
        {learnerModel && learnerModel.structures.length > 0 && (
          <AIInsights model={learnerModel} />
        )}

        {/* Adaptive Learning Path */}
        {learnerModel && learningPath.length > 0 && (
          <div className="rounded-xl bg-white p-5 ring-1 ring-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">Your Learning Path</h2>
            <p className="mb-4 mt-0.5 text-xs text-gray-400">Based on your conversation patterns</p>

            <div className="space-y-4">
              {/* Weak — needs practice */}
              {weakItems.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Needs practice</p>
                  <div className="space-y-1">
                    {weakItems.map((item) => (
                      <PathRow key={item.structureId} item={item} onPractice={(id) => router.push(`/chat?lesson=${id}`)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Developing */}
              {developingItems.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Developing</p>
                  <div className="space-y-1">
                    {developingItems.map((item) => (
                      <PathRow key={item.structureId} item={item} onPractice={(id) => router.push(`/chat?lesson=${id}`)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Solid */}
              {solidItems.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Solid</p>
                  <div className="space-y-1">
                    {solidItems.map((item) => (
                      <PathRow key={item.structureId} item={item} onPractice={(id) => router.push(`/chat?lesson=${id}`)} />
                    ))}
                  </div>
                </div>
              )}

              {/* New — not yet encountered */}
              {newItems.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Up next</p>
                  <div className="space-y-1">
                    {newItems.slice(0, 5).map((item) => (
                      <PathRow key={item.structureId} item={item} onPractice={(id) => router.push(`/chat?lesson=${id}`)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* No model yet — prompt to start */}
        {!learnerModel && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
            <p className="text-sm text-gray-600">
              Start a conversation in Quick Practice to build your personalized learning path.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-3 rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Start Practicing
            </button>
          </div>
        )}

        {/* CEFR Lesson Progress */}
        <div className="rounded-xl bg-white p-5 ring-1 ring-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">All Lessons</h2>
          <p className="mb-4 mt-0.5 text-xs text-gray-400">
            {totalCompleted} of {CURRICULUM.length} completed
          </p>
          <div className="space-y-3">
            {CEFR_LEVELS.map(({ level: lvl, label }) => {
              const lessons = CURRICULUM.filter((l) => l.cefrLevel === lvl);
              const completed = lessons.filter((l) => progress[l.id]?.status === "completed").length;
              const pct = lessons.length > 0 ? Math.round((completed / lessons.length) * 100) : 0;
              return (
                <div key={lvl}>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-700">{lvl}</span>
                      <span className="text-xs text-gray-500">{label}</span>
                    </div>
                    <span className="text-xs text-gray-400">{completed}/{lessons.length}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gray-900 transition-all"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A single mistake row */
function MistakeRow({
  error,
  structure,
  onPractice,
}: {
  error: ErrorPattern;
  structure?: { mastery: number; name: string };
  onPractice: (lessonId: string) => void;
}) {
  const lessonId = getLessonForStructure(error.structureId);
  const mastery = structure ? Math.round(structure.mastery * 100) : 0;
  const levelColor =
    error.correctionLevel === "explicit"
      ? "bg-red-100 text-red-700"
      : error.correctionLevel === "highlight"
      ? "bg-amber-100 text-amber-700"
      : "bg-gray-100 text-gray-500";

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-gray-50">
      {/* Error count badge */}
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${levelColor}`}>
        {error.count}
      </span>

      {/* Mistake info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-red-600 line-through">{error.example}</span>
          <span className="text-xs text-gray-400">&rarr;</span>
          <span className="text-sm font-medium text-green-700">{error.correction}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <span>{structure?.name ?? error.structureId}</span>
          {structure && <span>{mastery}% mastery</span>}
        </div>
      </div>

      {/* Practice button */}
      {lessonId && (
        <button
          onClick={() => onPractice(lessonId)}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
        >
          Practice
        </button>
      )}
    </div>
  );
}

/** AI Insights — shows how the system is adapting to the learner */
function AIInsights({ model }: { model: LearnerModel }) {
  const totalErrors = model.errorPatterns.reduce((sum, e) => sum + e.count, 0);
  const weakStructures = model.structures.filter((s) => s.mastery < 0.4);
  const improvingStructures = model.structures.filter((s) => s.lastCorrect && s.mastery > 0.3);
  const escalatedErrors = model.errorPatterns.filter((e) => e.correctionLevel === "explicit");
  const srsActive = model.spacedRepetitionQueue.length;

  // Top struggle area
  const topStruggle = [...model.errorPatterns].sort((a, b) => b.count - a.count)[0];

  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-gray-100">
      <h2 className="text-sm font-semibold text-gray-800">How the AI Sees Your Learning</h2>
      <p className="mb-4 mt-0.5 text-xs text-gray-400">
        The coach adapts in real-time based on your patterns
      </p>

      <div className="space-y-3 text-sm text-gray-600">
        {/* Correction strategy */}
        {escalatedErrors.length > 0 && (
          <div className="rounded-lg bg-red-50 px-4 py-3">
            <p className="font-medium text-red-800">Full explanations active</p>
            <p className="mt-0.5 text-xs text-red-600">
              {escalatedErrors.map((e) => {
                const name = model.structures.find((s) => s.id === e.structureId)?.name ?? e.structureId;
                return name;
              }).join(", ")} — corrected 3+ times, so the coach now gives detailed rules and L1 comparisons
            </p>
          </div>
        )}

        {/* Top struggle */}
        {topStruggle && (
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-gray-400">&#9679;</span>
            <p>
              <span className="font-medium">Top focus area:</span>{" "}
              {model.structures.find((s) => s.id === topStruggle.structureId)?.name ?? topStruggle.structureId}{" "}
              ({topStruggle.count} errors). The coach is steering conversation prompts toward this.
            </p>
          </div>
        )}

        {/* SRS status */}
        {srsActive > 0 && (
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-gray-400">&#9679;</span>
            <p>
              <span className="font-medium">Spaced repetition:</span>{" "}
              {srsActive} structure{srsActive > 1 ? "s" : ""} in the review queue. The coach times prompts to re-test you at optimal intervals.
            </p>
          </div>
        )}

        {/* Improving */}
        {improvingStructures.length > 0 && (
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-green-400">&#9679;</span>
            <p>
              <span className="font-medium">Improving:</span>{" "}
              {improvingStructures.map((s) => s.name).join(", ")} — trending upward, the coach will test these less often.
            </p>
          </div>
        )}

        {/* Weak areas being targeted */}
        {weakStructures.length > 0 && (
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-amber-400">&#9679;</span>
            <p>
              <span className="font-medium">Targeting:</span>{" "}
              {weakStructures.map((s) => `${s.name} (${Math.round(s.mastery * 100)}%)`).join(", ")} — below 40% mastery, the coach prioritizes these in prompts.
            </p>
          </div>
        )}

        {/* Overall progress */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-gray-400">&#9679;</span>
          <p>
            <span className="font-medium">Overall:</span>{" "}
            {model.totalTurns} sentences analyzed, {model.structures.length} structures discovered, {totalErrors} total corrections made.
            Level: {model.detectedLevel}.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Mastery trend visualization using CSS bars (no chart library needed) */
function MasteryTrendChart({ snapshots }: { snapshots: MasterySnapshot[] }) {
  const trend = getAggregateTrend(snapshots);
  const maxMastery = Math.max(...trend.map((t) => t.avgMastery), 0.1);

  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-gray-100">
      <h2 className="text-sm font-semibold text-gray-800">Progress Over Time</h2>
      <p className="mb-4 mt-0.5 text-xs text-gray-400">
        Average mastery across {trend.length} session{trend.length !== 1 ? "s" : ""}
      </p>

      {/* Mastery bar chart */}
      <div className="flex items-end gap-1 h-24">
        {trend.map((point, i) => {
          const height = Math.max((point.avgMastery / maxMastery) * 100, 4);
          const isLatest = i === trend.length - 1;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1"
              title={`Session ${point.session}: ${Math.round(point.avgMastery * 100)}% avg mastery, ${point.mastered} mastered`}
            >
              <span className="text-[9px] text-gray-400">
                {Math.round(point.avgMastery * 100)}%
              </span>
              <div
                className={`w-full rounded-t transition-all ${isLatest ? "bg-gray-900" : "bg-gray-300"}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Session labels */}
      <div className="flex gap-1 mt-1">
        {trend.map((point, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-gray-400">
            S{point.session}
          </div>
        ))}
      </div>

      {/* Summary stats */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 py-2">
          <p className="text-sm font-bold text-gray-900">
            {trend.length > 0 ? Math.round(trend[trend.length - 1].avgMastery * 100) : 0}%
          </p>
          <p className="text-[10px] text-gray-400">Current avg</p>
        </div>
        <div className="rounded-lg bg-gray-50 py-2">
          <p className="text-sm font-bold text-gray-900">
            {trend.length > 0 ? trend[trend.length - 1].mastered : 0}
          </p>
          <p className="text-[10px] text-gray-400">Mastered</p>
        </div>
        <div className="rounded-lg bg-gray-50 py-2">
          <p className="text-sm font-bold text-gray-900">
            {trend.length > 0 ? trend[trend.length - 1].totalErrors : 0}
          </p>
          <p className="text-[10px] text-gray-400">Total errors</p>
        </div>
      </div>
    </div>
  );
}

/** A single row in the learning path */
function PathRow({ item, onPractice }: { item: PathItem; onPractice: (lessonId: string) => void }) {
  const masteryPct = Math.round(item.mastery * 100);

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-50">
      {/* Mastery bar (tiny) */}
      <div className="w-12">
        <div className="h-1 w-full rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-gray-900 transition-all"
            style={{ width: `${Math.max(masteryPct, 2)}%` }}
          />
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-gray-700">{item.structureName}</span>
          {item.improving && (
            <span className="text-[10px] text-gray-400">&uarr;</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <span>{item.cefrLevel}</span>
          {item.status !== "new" && <span>{masteryPct}%</span>}
          {item.errorCount > 0 && <span>{item.errorCount} errors</span>}
        </div>
      </div>

      {/* Practice button */}
      {item.lessonId && item.status !== "solid" && (
        <button
          onClick={() => onPractice(item.lessonId!)}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
        >
          Practice
        </button>
      )}
    </div>
  );
}
