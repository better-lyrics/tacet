import { describe, expect, it } from "vitest";
import { advanceAhead, describeAhead } from "@/orchestrator/ahead-status";
import type { AheadActivity } from "@/orchestrator/ahead-status";

const EVERY: AheadActivity[] = ["queued", "downloading", "separating", "ready", "unavailable"];

describe("advanceAhead", () => {
  it("takes the first activity a track is given", () => {
    expect(advanceAhead(null, "downloading")).toBe("downloading");
  });

  it("moves forward through the lifecycle", () => {
    expect(advanceAhead("queued", "downloading")).toBe("downloading");
    expect(advanceAhead("downloading", "separating")).toBe("separating");
    expect(advanceAhead("separating", "ready")).toBe("ready");
  });

  describe("edge cases", () => {
    it("refuses to go backwards when a late message arrives out of order", () => {
      expect(advanceAhead("ready", "downloading")).toBe("ready");
      expect(advanceAhead("separating", "queued")).toBe("separating");
    });

    it("lets a failure land on a track that had reached the end", () => {
      expect(advanceAhead("ready", "unavailable")).toBe("unavailable");
    });

    it("repeating an activity is not a step backwards", () => {
      for (const activity of EVERY) expect(advanceAhead(activity, activity)).toBe(activity);
    });
  });

  describe("invariants", () => {
    it("never answers with anything but one of the activities it was given", () => {
      for (const current of EVERY) {
        for (const next of EVERY) {
          expect([current, next]).toContain(advanceAhead(current, next));
        }
      }
    });
  });
});

describe("describeAhead", () => {
  it("says what the track is doing", () => {
    expect(describeAhead("separating", null, null)).toBe("Separating");
    expect(describeAhead("ready", null, null)).toBe("Ready");
  });

  it("carries progress for the two activities that have any", () => {
    expect(describeAhead("downloading", 0.42, null)).toBe("Downloading 42%");
    expect(describeAhead("separating", 0.5, null)).toBe("Separating 50%");
  });

  describe("edge cases", () => {
    it("falls back to the cache answer before any activity is known", () => {
      expect(describeAhead(null, null, true)).toBe("Ready");
      expect(describeAhead(null, null, false)).toBe("Queued");
    });

    it("says nothing at all when neither is known", () => {
      expect(describeAhead(null, null, null)).toBe("");
    });

    it("drops a percentage that is not a number rather than printing NaN", () => {
      expect(describeAhead("downloading", Number.NaN, null)).toBe("Downloading");
      expect(describeAhead("downloading", Number.POSITIVE_INFINITY, null)).toBe("Downloading");
    });

    it("clamps a fraction outside zero to one", () => {
      expect(describeAhead("downloading", 1.4, null)).toBe("Downloading 100%");
      expect(describeAhead("downloading", -0.2, null)).toBe("Downloading 0%");
    });

    it("ignores a percentage on an activity that has no progress to report", () => {
      expect(describeAhead("ready", 0.5, null)).toBe("Ready");
      expect(describeAhead("queued", 0.5, null)).toBe("Queued");
    });
  });

  describe("invariants", () => {
    it("an activity outranks the cache answer, which is only a fallback", () => {
      expect(describeAhead("separating", null, true)).toBe("Separating");
      expect(describeAhead("ready", null, false)).toBe("Ready");
      expect(describeAhead("downloading", null, true)).toBe("Downloading");
    });

    it("never answers with an empty string once an activity is known", () => {
      for (const activity of EVERY) expect(describeAhead(activity, null, null).length).toBeGreaterThan(0);
    });
  });
});
