import { describe, expect, it } from "vitest";
import type { SeparationActivity } from "@/orchestrator/separation-activity";
import { describeSeparation, separationFill, separationText } from "@/orchestrator/separation-status";

const ACTIVITIES: SeparationActivity[] = [
  { kind: "off" },
  { kind: "asking" },
  { kind: "waiting" },
  { kind: "downloading", source: "shadow-url", fraction: 0.25 },
  { kind: "downloading", source: "hidden-player", fraction: 0.5 },
  { kind: "downloading", source: "player-capture", fraction: 0.75 },
  { kind: "working", stage: "separating", processed: 1, total: 4 },
  { kind: "working", stage: null, processed: 0, total: 0 },
  { kind: "ready-to-engage" },
  { kind: "engaged" },
  { kind: "failed", reason: "no backend" },
];

function separating(processed: number, total: number): SeparationActivity {
  return { kind: "working", stage: "separating", processed, total };
}

describe("separation status", () => {
  describe("happy path", () => {
    it("counts a separation up", () => {
      const status = describeSeparation(separating(5, 8));
      expect(status).toEqual({ label: "Separating", percent: 0.625, fill: 0.625 });
      expect(separationText(status)).toBe("Separating 63%");
      expect(separationFill(status)).toBeCloseTo(0.625);
    });

    it("reads Ready with a full bar and no number once stems are playing", () => {
      const status = describeSeparation({ kind: "engaged" });
      expect(separationText(status)).toBe("Ready");
      expect(separationFill(status)).toBe(1);
    });

    it("names each stage of the pipeline", () => {
      const labels = ["checking-cache", "decoding", "downloading-model", "loading-model", "encoding"].map(
        stage => describeSeparation({ kind: "working", stage, processed: 0, total: 0 })?.label
      );
      expect(labels).toEqual(["Checking", "Decoding", "Downloading model", "Loading model", "Finishing"]);
    });

    it("tells the two downloads apart, as the hover card does", () => {
      const fetched = describeSeparation({ kind: "downloading", source: "hidden-player", fraction: 0.4 });
      const buffered = describeSeparation({ kind: "downloading", source: "player-capture", fraction: 0.4 });
      expect(separationText(fetched)).toBe("Downloading track 40%");
      expect(separationText(buffered)).toBe("Buffering 40%");
    });

    it("invites the tap while nothing has asked for the track", () => {
      expect(separationText(describeSeparation({ kind: "asking" }))).toBe("Tap to separate");
    });
  });

  describe("edge cases", () => {
    it("says nothing when separation is off", () => {
      expect(describeSeparation({ kind: "off" })).toBeNull();
      expect(separationText(null)).toBe("");
      expect(separationFill(null)).toBe(0);
    });

    it("waits without a number before any audio has arrived", () => {
      const status = describeSeparation({ kind: "waiting" });
      expect(separationText(status)).toBe("Waiting for audio");
      expect(separationFill(status)).toBe(0);
    });

    it("invites the tap once a track is captured but not yet separating", () => {
      expect(separationText(describeSeparation({ kind: "ready-to-engage" }))).toBe("Tap to separate");
    });

    it("says a failure plainly", () => {
      expect(separationText(describeSeparation({ kind: "failed", reason: "no backend" }))).toBe("Unavailable");
    });

    it("falls back to Preparing for a stage it does not know", () => {
      expect(describeSeparation({ kind: "working", stage: "warp-drive", processed: 0, total: 0 })?.label).toBe(
        "Preparing"
      );
      expect(describeSeparation({ kind: "working", stage: null, processed: 0, total: 0 })?.label).toBe("Preparing");
    });

    it("shows no number for a separation that has not counted its segments yet", () => {
      const status = describeSeparation(separating(0, 0));
      expect(separationText(status)).toBe("Separating");
      expect(separationFill(status)).toBe(0);
    });

    it("shows no number for a download whose fraction is not yet finite", () => {
      const status = describeSeparation({ kind: "downloading", source: "hidden-player", fraction: Number.NaN });
      expect(separationText(status)).toBe("Downloading track");
    });
  });

  describe("invariants", () => {
    it("keeps the fill inside the bar whatever the pipeline reports", () => {
      for (const [processed, total] of [
        [12, 8],
        [-3, 8],
        [0, 8],
      ]) {
        const fill = separationFill(describeSeparation(separating(processed, total)));
        expect(fill).toBeGreaterThanOrEqual(0);
        expect(fill).toBeLessThanOrEqual(1);
      }
    });

    it("describes every activity except the one where separation is off", () => {
      for (const activity of ACTIVITIES) {
        if (activity.kind === "off") expect(describeSeparation(activity)).toBeNull();
        else expect(describeSeparation(activity)).not.toBeNull();
      }
    });

    it("never puts a download's progress into the bar", () => {
      for (const activity of ACTIVITIES) {
        if (activity.kind !== "downloading") continue;
        expect(separationFill(describeSeparation(activity))).toBe(0);
      }
    });
  });

  describe("regressions", () => {
    it("regression: Ready never renders as a percentage", () => {
      expect(separationText(describeSeparation({ kind: "engaged" }))).not.toContain("%");
    });

    it("regression: an overshooting segment count still reads as at most 100%", () => {
      expect(separationText(describeSeparation(separating(9, 8)))).toBe("Separating 100%");
    });

    it("regression: Finishing holds the bar where separating left it instead of sweeping back to nothing", () => {
      const finishing: SeparationActivity = { kind: "working", stage: "encoding", processed: 19, total: 20 };
      expect(separationText(describeSeparation(finishing))).toBe("Finishing");
      expect(separationFill(describeSeparation(finishing))).toBe(
        separationFill(describeSeparation(separating(19, 20)))
      );
    });

    it("regression: the bar never runs backwards across a whole track", () => {
      const run: SeparationActivity[] = [
        { kind: "waiting" },
        { kind: "downloading", source: "hidden-player", fraction: 0.2 },
        { kind: "downloading", source: "hidden-player", fraction: 0.9 },
        { kind: "working", stage: "checking-cache", processed: 0, total: 0 },
        { kind: "working", stage: "decoding", processed: 0, total: 0 },
        { kind: "working", stage: "downloading-model", processed: 0, total: 0 },
        separating(1, 20),
        separating(19, 20),
        { kind: "working", stage: "encoding", processed: 19, total: 20 },
        { kind: "engaged" },
      ];
      const fills = run.map(step => separationFill(describeSeparation(step)));
      for (let index = 1; index < fills.length; index++) {
        expect(fills[index]).toBeGreaterThanOrEqual(fills[index - 1]);
      }
      expect(fills.at(-1)).toBe(1);
    });

    it("regression: the download's percentage stays in the text and out of the bar", () => {
      const status = describeSeparation({ kind: "downloading", source: "hidden-player", fraction: 0.67 });
      expect(separationText(status)).toBe("Downloading track 67%");
      expect(separationFill(status)).toBe(0);
    });

    it("regression: the popup does not claim a download while nothing has asked for the track", () => {
      expect(separationText(describeSeparation({ kind: "asking" }))).toBe("Tap to separate");
      expect(separationText(describeSeparation({ kind: "asking" }))).not.toBe("Waiting for audio");
    });

    it("regression: a shadow pull is not reported as the listener's own buffering", () => {
      const shadow = describeSeparation({ kind: "downloading", source: "shadow-url", fraction: 0.4 });
      expect(shadow?.label).toBe("Downloading track");
      expect(shadow?.label).not.toBe("Buffering");
    });
  });
});
