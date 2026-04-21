import { LearnerModel, GrammarStructure, ErrorPattern, CefrLevel } from "@/types";

// ── Storage Keys ──

const SNAPSHOTS_KEY = "grammarcoach_mastery_snapshots";
const SUMMARIES_KEY = "grammarcoach_session_summaries";

// ── Types ──

export interface MasterySnapshot {
  sessionNumber: number;
  timestamp: string; // ISO date
  detectedLevel: CefrLevel;
  totalTurns: number;
  structures: {
    id: string;
    name: string;
    mastery: number;
    attempts: number;
    lastCorrect: boolean | null;
  }[];
  errorCounts: {
    structureId: string;
    count: number;
  }[];
  /** Aggregate stats for quick charting */
  stats: {
    avgMastery: number;
    totalErrors: number;
    structuresDiscovered: number;
    structuresMastered: number; // mastery >= 0.8
  };
}

export interface SessionSummary {
  sessionNumber: number;
  timestamp: string;
  turnCount: number;
  structuresPracticed: string[];
  errorsThisSession: number;
  masteryDeltas: { structureId: string; name: string; before: number; after: number }[];
  summaryText: string; // Claude-generated or computed
  topStrength: string | null;
  topWeakness: string | null;
}

export interface PersistentErrorAlert {
  structureId: string;
  structureName: string;
  totalCount: number;
  sessionsWithError: number;
  lastSessionNumber: number;
  severity: "watch" | "concern" | "intervention";
}

// ── Snapshot Management ──

export function loadSnapshots(): MasterySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSnapshots(snapshots: MasterySnapshot[]) {
  if (typeof window === "undefined") return;
  // Keep last 100 snapshots max
  const trimmed = snapshots.slice(-100);
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(trimmed));
}

export function takeSnapshot(model: LearnerModel): MasterySnapshot {
  const structures = model.structures.map((s) => ({
    id: s.id,
    name: s.name,
    mastery: s.mastery,
    attempts: s.attempts,
    lastCorrect: s.lastCorrect,
  }));

  const errorCounts = model.errorPatterns.map((e) => ({
    structureId: e.structureId,
    count: e.count,
  }));

  const masteries = model.structures.filter((s) => s.attempts > 0).map((s) => s.mastery);
  const avgMastery = masteries.length > 0
    ? masteries.reduce((a, b) => a + b, 0) / masteries.length
    : 0;

  const snapshot: MasterySnapshot = {
    sessionNumber: model.sessionCount,
    timestamp: new Date().toISOString(),
    detectedLevel: model.detectedLevel,
    totalTurns: model.totalTurns,
    structures,
    errorCounts,
    stats: {
      avgMastery: Math.round(avgMastery * 100) / 100,
      totalErrors: model.errorPatterns.reduce((sum, e) => sum + e.count, 0),
      structuresDiscovered: model.structures.filter((s) => s.attempts > 0).length,
      structuresMastered: model.structures.filter((s) => s.mastery >= 0.8).length,
    },
  };

  const all = loadSnapshots();
  all.push(snapshot);
  saveSnapshots(all);
  return snapshot;
}

// ── Session Summary Management ──

export function loadSummaries(): SessionSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SUMMARIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSummaries(summaries: SessionSummary[]) {
  if (typeof window === "undefined") return;
  const trimmed = summaries.slice(-50);
  localStorage.setItem(SUMMARIES_KEY, JSON.stringify(trimmed));
}

export function generateSessionSummary(
  beforeModel: LearnerModel,
  afterModel: LearnerModel,
  turnCount: number,
  structuresPracticed: string[]
): SessionSummary {
  // Compute mastery deltas
  const deltas: SessionSummary["masteryDeltas"] = [];
  for (const after of afterModel.structures) {
    const before = beforeModel.structures.find((s) => s.id === after.id);
    const beforeMastery = before?.mastery ?? 0;
    if (Math.abs(after.mastery - beforeMastery) > 0.01) {
      deltas.push({
        structureId: after.id,
        name: after.name,
        before: Math.round(beforeMastery * 100) / 100,
        after: Math.round(after.mastery * 100) / 100,
      });
    }
  }

  // Count errors this session (difference in total error counts)
  const beforeErrors = beforeModel.errorPatterns.reduce((s, e) => s + e.count, 0);
  const afterErrors = afterModel.errorPatterns.reduce((s, e) => s + e.count, 0);
  const errorsThisSession = afterErrors - beforeErrors;

  // Find top strength (biggest improvement) and weakness (biggest decline or most errors)
  const improvements = deltas.filter((d) => d.after > d.before).sort((a, b) => (b.after - b.before) - (a.after - a.before));
  const declines = deltas.filter((d) => d.after < d.before).sort((a, b) => (a.after - a.before) - (b.after - b.before));

  const topStrength = improvements[0]?.name ?? null;
  const topWeakness = declines[0]?.name ?? (
    afterModel.errorPatterns.length > 0
      ? afterModel.errorPatterns.sort((a, b) => b.count - a.count)[0]?.pattern ?? null
      : null
  );

  // Generate summary text
  const summaryParts: string[] = [];
  if (turnCount > 0) summaryParts.push(`You practiced ${turnCount} exchanges.`);
  if (structuresPracticed.length > 0) {
    summaryParts.push(`Topics covered: ${structuresPracticed.slice(0, 5).join(", ")}.`);
  }
  if (improvements.length > 0) {
    summaryParts.push(`Improved: ${improvements.map((d) => `${d.name} (${Math.round(d.before * 100)}% → ${Math.round(d.after * 100)}%)`).join(", ")}.`);
  }
  if (declines.length > 0) {
    summaryParts.push(`Needs work: ${declines.map((d) => d.name).join(", ")}.`);
  }
  if (errorsThisSession > 0) {
    summaryParts.push(`${errorsThisSession} error${errorsThisSession > 1 ? "s" : ""} corrected.`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("Session completed.");
  }

  const summary: SessionSummary = {
    sessionNumber: afterModel.sessionCount,
    timestamp: new Date().toISOString(),
    turnCount,
    structuresPracticed,
    errorsThisSession,
    masteryDeltas: deltas,
    summaryText: summaryParts.join(" "),
    topStrength,
    topWeakness,
  };

  const all = loadSummaries();
  all.push(summary);
  saveSummaries(all);
  return summary;
}

// ── Cross-Session Error Escalation ──

/**
 * Detect persistent error patterns across sessions.
 * Returns alerts for structures that need intervention.
 */
export function detectPersistentErrors(
  model: LearnerModel,
  snapshots: MasterySnapshot[]
): PersistentErrorAlert[] {
  const alerts: PersistentErrorAlert[] = [];

  for (const pattern of model.errorPatterns) {
    if (pattern.count < 3) continue;

    // Count how many sessions had this error
    let sessionsWithError = 0;
    for (const snap of snapshots) {
      const err = snap.errorCounts.find((e) => e.structureId === pattern.structureId);
      if (err && err.count > 0) sessionsWithError++;
    }

    // Check if mastery is stagnating (not improving despite practice)
    const structure = model.structures.find((s) => s.id === pattern.structureId);
    const mastery = structure?.mastery ?? 0;

    let severity: PersistentErrorAlert["severity"] = "watch";
    if (pattern.count >= 8 || (sessionsWithError >= 3 && mastery < 0.4)) {
      severity = "intervention"; // needs dedicated lesson
    } else if (pattern.count >= 5 || sessionsWithError >= 2) {
      severity = "concern"; // needs focused drilling
    }

    const structureName = structure?.name ?? pattern.structureId;

    alerts.push({
      structureId: pattern.structureId,
      structureName,
      totalCount: pattern.count,
      sessionsWithError,
      lastSessionNumber: model.sessionCount,
      severity,
    });
  }

  return alerts.sort((a, b) => {
    const severityOrder = { intervention: 0, concern: 1, watch: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

// ── Mastery Trend Helpers ──

/**
 * Get mastery trend for a specific structure across sessions.
 */
export function getStructureTrend(
  structureId: string,
  snapshots: MasterySnapshot[]
): { session: number; mastery: number; timestamp: string }[] {
  return snapshots
    .map((snap) => {
      const s = snap.structures.find((st) => st.id === structureId);
      return s ? { session: snap.sessionNumber, mastery: s.mastery, timestamp: snap.timestamp } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Get aggregate stats trend across sessions (for overview charts).
 */
export function getAggregateTrend(
  snapshots: MasterySnapshot[]
): { session: number; avgMastery: number; totalErrors: number; mastered: number; timestamp: string }[] {
  return snapshots.map((snap) => ({
    session: snap.sessionNumber,
    avgMastery: snap.stats.avgMastery,
    totalErrors: snap.stats.totalErrors,
    mastered: snap.stats.structuresMastered,
    timestamp: snap.timestamp,
  }));
}

// ── Intelligent Topic Selection ──

/**
 * Get recommended topics for the next session based on:
 * 1. Persistent errors (highest priority)
 * 2. SRS due items
 * 3. Weakest structures from learning path
 * 4. Untouched structures at current level
 */
export function getSmartTopicRecommendations(
  model: LearnerModel,
  snapshots: MasterySnapshot[],
  maxTopics: number = 5
): { structureId: string; name: string; reason: string; priority: number }[] {
  const topics: { structureId: string; name: string; reason: string; priority: number }[] = [];
  const seen = new Set<string>();

  // Priority 1: Persistent errors needing intervention
  const alerts = detectPersistentErrors(model, snapshots);
  for (const alert of alerts) {
    if (alert.severity === "intervention" && !seen.has(alert.structureId)) {
      topics.push({
        structureId: alert.structureId,
        name: alert.structureName,
        reason: `${alert.totalCount} errors across ${alert.sessionsWithError} sessions`,
        priority: 1,
      });
      seen.add(alert.structureId);
    }
  }

  // Priority 2: Structures with declining mastery
  if (snapshots.length >= 2) {
    const prev = snapshots[snapshots.length - 2];
    const curr = snapshots[snapshots.length - 1];
    for (const currStruct of curr?.structures ?? []) {
      const prevStruct = prev?.structures.find((s) => s.id === currStruct.id);
      if (prevStruct && currStruct.mastery < prevStruct.mastery - 0.1 && !seen.has(currStruct.id)) {
        topics.push({
          structureId: currStruct.id,
          name: currStruct.name,
          reason: `Declining: ${Math.round(prevStruct.mastery * 100)}% → ${Math.round(currStruct.mastery * 100)}%`,
          priority: 2,
        });
        seen.add(currStruct.id);
      }
    }
  }

  // Priority 3: Weakest practiced structures
  const weak = model.structures
    .filter((s) => s.attempts > 0 && s.mastery < 0.5 && !seen.has(s.id))
    .sort((a, b) => a.mastery - b.mastery);
  for (const s of weak.slice(0, 3)) {
    topics.push({
      structureId: s.id,
      name: s.name,
      reason: `${Math.round(s.mastery * 100)}% mastery after ${s.attempts} attempts`,
      priority: 3,
    });
    seen.add(s.id);
  }

  // Priority 4: Untouched structures at current level
  const untouched = model.structures
    .filter((s) => s.attempts === 0 && s.cefrLevel === model.detectedLevel && !seen.has(s.id));
  for (const s of untouched.slice(0, 2)) {
    topics.push({
      structureId: s.id,
      name: s.name,
      reason: "Not yet practiced at your level",
      priority: 4,
    });
    seen.add(s.id);
  }

  return topics.slice(0, maxTopics);
}
