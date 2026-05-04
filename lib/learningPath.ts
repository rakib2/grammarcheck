import { LearnerModel, GrammarStructure, CefrLevel } from "@/types";
import { GRAMMAR_STRUCTURES } from "./grammarStructures";

/**
 * Maps conversation engine structure IDs → curriculum lesson IDs.
 * When the engine detects a weak structure, this tells us which lesson to recommend.
 */
const STRUCTURE_TO_LESSON: Record<string, string> = {
  // A1
  a1_word_order_svo:   "a1-01",
  a1_sein_haben:       "a1-02",
  a1_present_tense:    "a1-03",
  a1_articles_gender:  "a1-04",
  a1_negation:         "a1-05",
  // A2
  a2_akkusativ:        "a1-08",  // Akkusativ is in A1 lessons
  a2_perfekt:          "a2-01",
  a2_modal_verbs:      "a2-02",
  a2_dativ:            "a2-03",
  a2_prepositions_akkdativ: "a2-04",
  // B1
  b1_nebensaetze:      "a2-06",  // subordinating conjunctions
  b1_praeteritum:      "b1-01",
  b1_reflexive_verbs:  "a2-05",
  b1_adjective_declension: "b1-08",
  b1_konjunktiv2:      "b1-05",
  // B2
  b2_passiv:           "b1-04",
  b2_genitiv:          "b1-02",
  b2_relative_clauses: "b1-03",
  b2_konjunktiv1:      "b2-01",
  // C1
  c1_partizip_constructions: "b2-02",
  c1_modal_particles:  "c1-02",
  // C2
  c2_funktionsverbgefuege: "c1-03",
  c2_academic_register: "c2-03",
};

export function getLessonForStructure(structureId: string): string | null {
  return STRUCTURE_TO_LESSON[structureId] ?? null;
}

/** Inverse of {@link getLessonForStructure}. Memoised on first call. */
let _lessonToStructure: Record<string, string> | null = null;
export function getStructureForLesson(lessonId: string): string | null {
  if (!_lessonToStructure) {
    _lessonToStructure = {};
    for (const [structureId, lid] of Object.entries(STRUCTURE_TO_LESSON)) {
      // Multiple structures can map to the same lesson; the first wins
      // because it's the canonical structure that lesson teaches.
      if (!_lessonToStructure[lid]) _lessonToStructure[lid] = structureId;
    }
  }
  return _lessonToStructure[lessonId] ?? null;
}

/**
 * A single item in the personalized learning path.
 */
export interface PathItem {
  structureId: string;
  structureName: string;
  cefrLevel: CefrLevel;
  lessonId: string | null;
  mastery: number;
  errorCount: number;
  urgency: number;        // higher = more urgent to practice
  improving: boolean;     // mastery trending up?
  status: "weak" | "developing" | "solid" | "new";
}

/**
 * Generate a personalized learning path from the learner model.
 *
 * Algorithm:
 *   urgency = (errorCount × recencyWeight) / (mastery + 0.1)
 *
 * - Structures with more recent, frequent errors rank highest
 * - Structures with high mastery drop to the bottom
 * - Structures never encountered get a small urgency (exploration)
 */
export function generateLearningPath(model: LearnerModel): PathItem[] {
  const now = Date.now();
  const items: PathItem[] = [];

  // Score all known structures
  for (const structure of model.structures) {
    const errorPattern = model.errorPatterns.find(
      (e) => e.structureId === structure.id
    );
    const errorCount = errorPattern?.count ?? 0;

    // Recency weight: errors from last session matter more
    const lastSeenMs = structure.lastSeen ? new Date(structure.lastSeen).getTime() : 0;
    const hoursSince = (now - lastSeenMs) / (1000 * 60 * 60);
    const recencyWeight = Math.max(0.5, 2 - hoursSince / 24); // decays over days

    const urgency = errorCount > 0
      ? (errorCount * recencyWeight) / (structure.mastery + 0.1)
      : 0;

    // Determine if improving: last attempt was correct and mastery > 0.4
    const improving = structure.lastCorrect === true && structure.mastery > 0.3;

    const status: PathItem["status"] =
      structure.mastery >= 0.75 ? "solid" :
      structure.mastery >= 0.4 ? "developing" : "weak";

    items.push({
      structureId: structure.id,
      structureName: structure.name,
      cefrLevel: structure.cefrLevel,
      lessonId: getLessonForStructure(structure.id),
      mastery: structure.mastery,
      errorCount,
      urgency,
      improving,
      status,
    });
  }

  // Add structures not yet encountered (exploration)
  const knownIds = new Set(model.structures.map((s) => s.id));
  const levelOrder: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const currentLevelIdx = levelOrder.indexOf(model.detectedLevel);

  // Only suggest structures at or one level above current
  for (const structDef of GRAMMAR_STRUCTURES) {
    if (knownIds.has(structDef.id)) continue;
    const structLevelIdx = levelOrder.indexOf(structDef.cefrLevel);
    if (structLevelIdx > currentLevelIdx + 1) continue;

    items.push({
      structureId: structDef.id,
      structureName: structDef.name,
      cefrLevel: structDef.cefrLevel,
      lessonId: getLessonForStructure(structDef.id),
      mastery: 0,
      errorCount: 0,
      urgency: 0.1, // small urgency for exploration
      improving: false,
      status: "new",
    });
  }

  // Sort: weak structures first (high urgency), then new, then solid
  items.sort((a, b) => b.urgency - a.urgency);

  return items;
}

/**
 * Get the top N recommended lessons based on the learning path.
 * Filters to only items that have a matching lesson.
 */
export function getRecommendedLessons(model: LearnerModel, count = 3): PathItem[] {
  const path = generateLearningPath(model);
  return path
    .filter((item) => item.lessonId && item.status !== "solid")
    .slice(0, count);
}

/**
 * Get an inline suggestion for the conversation UI.
 * Returns a suggestion when a structure has been corrected 2+ times.
 */
export function getInlineSuggestion(
  model: LearnerModel,
  structureId: string
): { message: string; lessonId: string } | null {
  const pattern = model.errorPatterns.find((p) => p.structureId === structureId);
  if (!pattern || pattern.count < 2) return null;

  const lessonId = getLessonForStructure(structureId);
  if (!lessonId) return null;

  const structDef = GRAMMAR_STRUCTURES.find((s) => s.id === structureId);
  const name = structDef?.name ?? structureId;

  const structure = model.structures.find((s) => s.id === structureId);
  const mastery = structure ? Math.round(structure.mastery * 100) : 0;

  return {
    message: `${name} — ${pattern.count} errors, ${mastery}% mastery. There's a focused lesson for this.`,
    lessonId,
  };
}
