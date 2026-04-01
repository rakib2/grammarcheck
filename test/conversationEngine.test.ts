import { describe, it, expect } from "vitest";
import {
  processUserTurn,
  createLearnerModel,
  createConversationState,
  getSessionOpener,
  EngineInput,
  APIAnalysisResult,
} from "@/lib/conversationEngine";
import { LearnerModel, ConversationState } from "@/types";

// ── Helpers ──

function makeAnalysis(overrides: Partial<APIAnalysisResult> = {}): APIAnalysisResult {
  return {
    tokens: [{ word: "Ich", status: "correct" }, { word: "gehe", status: "correct" }],
    score: 90,
    errorTypes: [],
    detectedLevel: "A2",
    structuresUsed: ["a1_word_order_svo"],
    errors: [],
    coachMessage: "Nice, that's correct!",
    nextPrompt: "What did you do today?",
    ...overrides,
  };
}

function makeInput(overrides: {
  model?: Partial<LearnerModel>;
  state?: Partial<ConversationState>;
  analysis?: Partial<APIAnalysisResult>;
  sentence?: string;
} = {}): EngineInput {
  const model = { ...createLearnerModel("English"), ...overrides.model };
  const state = { ...createConversationState(), ...overrides.state };
  return {
    userSentence: overrides.sentence ?? "Ich gehe nach Hause",
    learnerModel: model,
    conversationState: state,
    analysisFromAPI: makeAnalysis(overrides.analysis),
  };
}

// ── Tests ──

describe("conversationEngine", () => {
  describe("processUserTurn — happy path (no errors)", () => {
    it("returns the coach message as response text", () => {
      const output = processUserTurn(makeInput());
      expect(output.responseText).toBe("Nice, that's correct!");
    });

    it("returns empty corrections", () => {
      const output = processUserTurn(makeInput());
      expect(output.corrections).toHaveLength(0);
    });

    it("returns no rule card", () => {
      const output = processUserTurn(makeInput());
      expect(output.ruleCard).toBeNull();
    });

    it("increments totalTurns", () => {
      const output = processUserTurn(makeInput());
      expect(output.updatedModel.totalTurns).toBe(1);
    });

    it("updates structure mastery for correctly used structures", () => {
      const output = processUserTurn(makeInput());
      const structure = output.updatedModel.structures.find(
        (s) => s.id === "a1_word_order_svo"
      );
      expect(structure).toBeDefined();
      expect(structure!.mastery).toBe(0.7); // new structure, correct → 0.7
      expect(structure!.lastCorrect).toBe(true);
    });

    it("adds user and coach turns to conversation state", () => {
      const output = processUserTurn(makeInput());
      expect(output.updatedState.turns).toHaveLength(2);
      expect(output.updatedState.turns[0].role).toBe("user");
      expect(output.updatedState.turns[1].role).toBe("coach");
    });

    it("tracks session structures covered", () => {
      const output = processUserTurn(makeInput());
      expect(output.updatedState.sessionStructuresCovered).toContain("a1_word_order_svo");
    });
  });

  describe("processUserTurn — correction levels", () => {
    it("uses recast for first error on a structure", () => {
      const input = makeInput({
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ after mit",
          }],
          structuresUsed: ["a2_dativ"],
          score: 60,
        },
      });
      const output = processUserTurn(input);
      expect(output.corrections).toHaveLength(1);
      expect(output.corrections[0].level).toBe("recast");
    });

    it("uses highlight for second error on same structure", () => {
      const model = createLearnerModel("English");
      model.errorPatterns = [{
        id: "err_1",
        structureId: "a2_dativ",
        pattern: "mit + Nominativ",
        example: "mit mein",
        correction: "mit meinem",
        count: 2,
        correctionLevel: "recast",
        lastSeen: new Date().toISOString(),
      }];

      const input = makeInput({
        model,
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "von mein",
            correction: "von meinem",
            rule: "Dativ after von",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      expect(output.corrections[0].level).toBe("highlight");
    });

    it("uses explicit for third+ error on same structure", () => {
      const model = createLearnerModel("English");
      model.errorPatterns = [{
        id: "err_1",
        structureId: "a2_dativ",
        pattern: "mit + Nominativ",
        example: "mit mein",
        correction: "mit meinem",
        count: 3,
        correctionLevel: "highlight",
        lastSeen: new Date().toISOString(),
      }];

      const input = makeInput({
        model,
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "zu mein",
            correction: "zu meinem",
            rule: "Dativ after zu",
          }],
          structuresUsed: ["a2_dativ"],
          score: 40,
        },
      });
      const output = processUserTurn(input);
      expect(output.corrections[0].level).toBe("explicit");
      expect(output.ruleCard).not.toBeNull();
      expect(output.ruleCard!.structureName).toBeTruthy();
    });
  });

  describe("processUserTurn — SRS updates", () => {
    it("creates SRS item for new error", () => {
      const input = makeInput({
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ after mit",
          }],
          structuresUsed: ["a2_dativ"],
          score: 60,
        },
      });
      const output = processUserTurn(input);
      const srsItem = output.updatedModel.spacedRepetitionQueue.find(
        (s) => s.structureId === "a2_dativ"
      );
      expect(srsItem).toBeDefined();
      expect(srsItem!.interval).toBe(1);
    });

    it("updates existing SRS item for repeated error", () => {
      const model = createLearnerModel("English");
      model.spacedRepetitionQueue = [{
        id: "srs_1",
        structureId: "a2_dativ",
        dueAt: "turn:0",
        interval: 3,
        easeFactor: 2.5,
        repetitions: 2,
      }];

      const input = makeInput({
        model,
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ after mit",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      const srsItem = output.updatedModel.spacedRepetitionQueue.find(
        (s) => s.structureId === "a2_dativ"
      );
      expect(srsItem).toBeDefined();
      // Should reset interval on error
      expect(srsItem!.interval).toBe(1);
    });

    it("extends SRS interval for correctly used structures", () => {
      const model = createLearnerModel("English");
      model.spacedRepetitionQueue = [{
        id: "srs_1",
        structureId: "a1_word_order_svo",
        dueAt: "turn:0",
        interval: 1,
        easeFactor: 2.5,
        repetitions: 0,
      }];

      const input = makeInput({
        model,
        analysis: {
          structuresUsed: ["a1_word_order_svo"],
          errors: [],
          score: 95,
        },
      });
      const output = processUserTurn(input);
      const srsItem = output.updatedModel.spacedRepetitionQueue.find(
        (s) => s.structureId === "a1_word_order_svo"
      );
      expect(srsItem).toBeDefined();
      expect(srsItem!.repetitions).toBe(1);
    });
  });

  describe("processUserTurn — structure mastery", () => {
    it("initializes new structure with 0.7 mastery on correct", () => {
      const output = processUserTurn(makeInput());
      const structure = output.updatedModel.structures.find(
        (s) => s.id === "a1_word_order_svo"
      );
      expect(structure!.mastery).toBe(0.7);
    });

    it("initializes new structure with 0.2 mastery on error", () => {
      const input = makeInput({
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      const structure = output.updatedModel.structures.find(
        (s) => s.id === "a2_dativ"
      );
      expect(structure!.mastery).toBe(0.2);
    });

    it("increases mastery with EMA on repeated correct usage", () => {
      const model = createLearnerModel("English");
      model.structures = [{
        id: "a1_word_order_svo",
        name: "Word Order (SVO)",
        cefrLevel: "A1",
        mastery: 0.5,
        attempts: 3,
        lastSeen: new Date().toISOString(),
        lastCorrect: true,
      }];

      const input = makeInput({ model });
      const output = processUserTurn(input);
      const structure = output.updatedModel.structures.find(
        (s) => s.id === "a1_word_order_svo"
      );
      // EMA: 0.5 * 0.7 + 1 * 0.3 = 0.65
      expect(structure!.mastery).toBe(0.65);
    });

    it("decreases mastery with EMA on error", () => {
      const model = createLearnerModel("English");
      model.structures = [{
        id: "a2_dativ",
        name: "Dativ",
        cefrLevel: "A2",
        mastery: 0.6,
        attempts: 5,
        lastSeen: new Date().toISOString(),
        lastCorrect: true,
      }];

      const input = makeInput({
        model,
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      const structure = output.updatedModel.structures.find(
        (s) => s.id === "a2_dativ"
      );
      // EMA: 0.6 * 0.7 + 0 * 0.3 = 0.42
      expect(structure!.mastery).toBe(0.42);
    });
  });

  describe("processUserTurn — error patterns", () => {
    it("creates new error pattern on first error", () => {
      const input = makeInput({
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ after mit",
          }],
          structuresUsed: ["a2_dativ"],
          score: 60,
        },
      });
      const output = processUserTurn(input);
      const pattern = output.updatedModel.errorPatterns.find(
        (p) => p.structureId === "a2_dativ"
      );
      expect(pattern).toBeDefined();
      expect(pattern!.count).toBe(1);
      expect(pattern!.example).toBe("mit mein");
    });

    it("increments count on repeated error for same structure", () => {
      const model = createLearnerModel("English");
      model.errorPatterns = [{
        id: "err_1",
        structureId: "a2_dativ",
        pattern: "mit + Nominativ → Dativ",
        example: "mit mein",
        correction: "mit meinem",
        count: 2,
        correctionLevel: "highlight",
        lastSeen: new Date().toISOString(),
      }];

      const input = makeInput({
        model,
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "von mein",
            correction: "von meinem",
            rule: "Dativ after von",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      const pattern = output.updatedModel.errorPatterns.find(
        (p) => p.structureId === "a2_dativ"
      );
      expect(pattern!.count).toBe(3);
      expect(pattern!.example).toBe("von mein"); // updated to latest
    });
  });

  describe("processUserTurn — lesson suggestion", () => {
    it("returns null when error count < 2", () => {
      const input = makeInput({
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      expect(output.lessonSuggestion).toBeNull();
    });

    it("returns lesson suggestion when error count >= 2", () => {
      const model = createLearnerModel("English");
      model.errorPatterns = [{
        id: "err_1",
        structureId: "a2_dativ",
        pattern: "Dativ",
        example: "mit mein",
        correction: "mit meinem",
        count: 1, // will become 2 after this turn
        correctionLevel: "recast",
        lastSeen: new Date().toISOString(),
      }];
      model.structures = [{
        id: "a2_dativ",
        name: "Dativ",
        cefrLevel: "A2",
        mastery: 0.3,
        attempts: 2,
        lastSeen: new Date().toISOString(),
        lastCorrect: false,
      }];

      const input = makeInput({
        model,
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "von mein",
            correction: "von meinem",
            rule: "Dativ after von",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      expect(output.lessonSuggestion).not.toBeNull();
      expect(output.lessonSuggestion!.lessonId).toBe("a2-03");
    });
  });

  describe("createLearnerModel", () => {
    it("creates model with correct defaults", () => {
      const model = createLearnerModel("Bengali");
      expect(model.nativeLanguage).toBe("Bengali");
      expect(model.coachLanguage).toBe("Bengali");
      expect(model.detectedLevel).toBe("A1");
      expect(model.structures).toHaveLength(0);
      expect(model.errorPatterns).toHaveLength(0);
      expect(model.spacedRepetitionQueue).toHaveLength(0);
      expect(model.sessionCount).toBe(0);
      expect(model.totalTurns).toBe(0);
    });
  });

  describe("createConversationState", () => {
    it("creates empty state", () => {
      const state = createConversationState();
      expect(state.turns).toHaveLength(0);
      expect(state.currentTarget).toBeNull();
      expect(state.turnsSinceLastCorrection).toBe(0);
      expect(state.sessionStructuresCovered).toHaveLength(0);
    });
  });

  describe("getSessionOpener", () => {
    it("returns welcome for first session", () => {
      const model = createLearnerModel("English");
      const opener = getSessionOpener(model);
      expect(opener).toContain("Hey");
      expect(opener.length).toBeGreaterThan(20);
    });

    it("returns different message for second session", () => {
      const model = createLearnerModel("English");
      model.sessionCount = 1;
      const opener = getSessionOpener(model);
      expect(opener).toContain("welcome back");
    });

    it("returns personalized opener for returning user", () => {
      const model = createLearnerModel("English");
      model.sessionCount = 5;
      model.totalTurns = 50;
      model.detectedLevel = "B1";
      model.structures = [
        { id: "a1_word_order_svo", name: "Word Order", cefrLevel: "A1", mastery: 0.8, attempts: 10, lastSeen: new Date().toISOString(), lastCorrect: true },
        { id: "a2_dativ", name: "Dativ", cefrLevel: "A2", mastery: 0.3, attempts: 5, lastSeen: new Date().toISOString(), lastCorrect: false },
      ];
      const opener = getSessionOpener(model);
      expect(opener.length).toBeGreaterThan(20);
    });
  });

  describe("processUserTurn — conversation state updates", () => {
    it("resets turnsSinceLastCorrection on error", () => {
      const state = createConversationState();
      state.turnsSinceLastCorrection = 5;

      const input = makeInput({
        state,
        analysis: {
          errors: [{
            structureId: "a2_dativ",
            original: "mit mein",
            correction: "mit meinem",
            rule: "Dativ",
          }],
          structuresUsed: ["a2_dativ"],
          score: 50,
        },
      });
      const output = processUserTurn(input);
      expect(output.updatedState.turnsSinceLastCorrection).toBe(0);
    });

    it("increments turnsSinceLastCorrection when no errors", () => {
      const state = createConversationState();
      state.turnsSinceLastCorrection = 3;

      const input = makeInput({ state });
      const output = processUserTurn(input);
      expect(output.updatedState.turnsSinceLastCorrection).toBe(4);
    });
  });
});
