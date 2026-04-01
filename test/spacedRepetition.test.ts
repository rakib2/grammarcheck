import { describe, it, expect } from "vitest";
import {
  createSRSItem,
  updateSRSItem,
  getDueItems,
  assessQuality,
} from "@/lib/spacedRepetition";

describe("spacedRepetition", () => {
  describe("createSRSItem", () => {
    it("creates an item with initial values", () => {
      const item = createSRSItem("a2_dativ");
      expect(item.structureId).toBe("a2_dativ");
      expect(item.interval).toBe(1);
      expect(item.easeFactor).toBe(2.5);
      expect(item.repetitions).toBe(0);
      expect(item.id).toMatch(/^srs_a2_dativ_/);
    });
  });

  describe("updateSRSItem", () => {
    it("resets interval on failure (quality < 3)", () => {
      const item = createSRSItem("a2_dativ");
      item.interval = 8;
      item.repetitions = 3;
      const updated = updateSRSItem(item, 1, 10);
      expect(updated.interval).toBe(1);
      expect(updated.repetitions).toBe(0);
      expect(updated.dueAt).toBe("turn:11");
    });

    it("sets interval to 1 on first success", () => {
      const item = createSRSItem("a2_dativ");
      const updated = updateSRSItem(item, 4, 5);
      expect(updated.interval).toBe(1);
      expect(updated.repetitions).toBe(1);
      expect(updated.dueAt).toBe("turn:6");
    });

    it("sets interval to 3 on second success", () => {
      const item = createSRSItem("a2_dativ");
      const first = updateSRSItem(item, 4, 5);
      const second = updateSRSItem(first, 4, 6);
      expect(second.interval).toBe(3);
      expect(second.repetitions).toBe(2);
      expect(second.dueAt).toBe("turn:9");
    });

    it("multiplies interval by ease factor on third+ success", () => {
      const item = createSRSItem("a2_dativ");
      const first = updateSRSItem(item, 5, 1);
      const second = updateSRSItem(first, 5, 2);
      const third = updateSRSItem(second, 5, 5);
      // interval = round(3 * easeFactor)
      expect(third.interval).toBeGreaterThan(3);
      expect(third.repetitions).toBe(3);
    });

    it("clamps quality to 0-5 range", () => {
      const item = createSRSItem("a2_dativ");
      const neg = updateSRSItem(item, -1, 5);
      expect(neg.interval).toBe(1); // treated as quality 0 → fail
      expect(neg.repetitions).toBe(0);

      const high = updateSRSItem(item, 10, 5);
      expect(high.repetitions).toBe(1); // treated as quality 5 → success
    });

    it("never drops ease factor below MIN_EASE (1.3)", () => {
      let item = createSRSItem("a2_dativ");
      // Repeatedly fail to drive ease down
      for (let i = 0; i < 20; i++) {
        item = updateSRSItem(item, 3, i); // quality 3 reduces ease
      }
      expect(item.easeFactor).toBeGreaterThanOrEqual(1.3);
    });
  });

  describe("getDueItems", () => {
    it("returns items due at or before current turn", () => {
      const items = [
        { ...createSRSItem("a"), dueAt: "turn:5" },
        { ...createSRSItem("b"), dueAt: "turn:10" },
        { ...createSRSItem("c"), dueAt: "turn:3" },
      ];
      const due = getDueItems(items, 5);
      expect(due).toHaveLength(2);
      expect(due.map((d) => d.structureId)).toContain("a");
      expect(due.map((d) => d.structureId)).toContain("c");
    });

    it("returns empty array when nothing is due", () => {
      const items = [{ ...createSRSItem("a"), dueAt: "turn:100" }];
      expect(getDueItems(items, 5)).toHaveLength(0);
    });

    it("sorts by shortest interval first", () => {
      const items = [
        { ...createSRSItem("a"), dueAt: "turn:1", interval: 8 },
        { ...createSRSItem("b"), dueAt: "turn:1", interval: 1 },
      ];
      const due = getDueItems(items, 5);
      expect(due[0].structureId).toBe("b");
    });

    it("treats legacy date format as due now", () => {
      const items = [
        { ...createSRSItem("a"), dueAt: new Date().toISOString() },
      ];
      expect(getDueItems(items, 0)).toHaveLength(1);
    });
  });

  describe("assessQuality", () => {
    it("returns 0 for explicit error", () => {
      expect(assessQuality(false, "explicit", false)).toBe(0);
    });

    it("returns 1 for highlight error", () => {
      expect(assessQuality(false, "highlight", false)).toBe(1);
    });

    it("returns 2 for recast error", () => {
      expect(assessQuality(false, "recast", false)).toBe(2);
    });

    it("returns 5 for naturally correct usage", () => {
      expect(assessQuality(true, "recast", true)).toBe(5);
    });

    it("returns 4 for correct with recast (not natural)", () => {
      expect(assessQuality(true, "recast", false)).toBe(4);
    });

    it("returns 3 for correct but not recast or natural", () => {
      expect(assessQuality(true, "highlight", false)).toBe(3);
    });
  });
});
