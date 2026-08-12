import { initialKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { describeSeparation, separationFill, separationText } from "@/orchestrator/separation-status";
import { describe, expect, it } from "vitest";

const VIDEO_ID = "DJCB1ZlseJ8";

function state(patch: Partial<KaraokeState>): KaraokeState {
  return { ...initialKaraokeState(VIDEO_ID), ...patch };
}

describe("separation status", () => {
  describe("happy path", () => {
    it("counts a separation up", () => {
      const status = describeSeparation(state({ status: "processing", stage: "separating", processed: 5, total: 8 }));
      expect(status).toEqual({ label: "Separating", percent: 0.625, fill: 0.625 });
      expect(separationText(status)).toBe("Separating 63%");
      expect(separationFill(status)).toBeCloseTo(0.625);
    });

    it("reads Ready with a full bar and no number once stems are playing", () => {
      const status = describeSeparation(state({ status: "engaged" }));
      expect(separationText(status)).toBe("Ready");
      expect(separationFill(status)).toBe(1);
    });

    it("names each stage of the pipeline", () => {
      const labels = ["checking-cache", "decoding", "downloading-model", "loading-model", "encoding"].map(
        stage => describeSeparation(state({ status: "processing", stage }))?.label
      );
      expect(labels).toEqual(["Checking", "Decoding", "Downloading model", "Loading model", "Finishing"]);
    });

    it("tells the two downloads apart, as the hover card does", () => {
      const hidden = describeSeparation(
        state({ status: "waiting-for-capture", downloadSource: "hidden-player", downloadFraction: 0.4 })
      );
      const listener = describeSeparation(
        state({ status: "waiting-for-capture", downloadSource: "listener-playback", downloadFraction: 0.4 })
      );
      expect(separationText(hidden)).toBe("Downloading track 40%");
      expect(separationText(listener)).toBe("Buffering 40%");
    });
  });

  describe("edge cases", () => {
    it("says nothing when there is no pipeline to describe", () => {
      expect(describeSeparation(null)).toBeNull();
      expect(separationText(null)).toBe("");
      expect(separationFill(null)).toBe(0);
    });

    it("waits without a number before any audio has arrived", () => {
      const status = describeSeparation(state({ status: "waiting-for-capture" }));
      expect(separationText(status)).toBe("Waiting for audio");
      expect(separationFill(status)).toBe(0);
    });

    it("invites the tap once a track is captured but not yet separating", () => {
      expect(separationText(describeSeparation(state({ status: "ready-to-engage" })))).toBe("Tap to separate");
    });

    it("says a failure plainly", () => {
      expect(separationText(describeSeparation(state({ status: "failed", reason: "no backend" })))).toBe("Unavailable");
    });

    it("falls back to Preparing for a stage it does not know", () => {
      expect(describeSeparation(state({ status: "processing", stage: "warp-drive" }))?.label).toBe("Preparing");
      expect(describeSeparation(state({ status: "processing", stage: null }))?.label).toBe("Preparing");
    });

    it("shows no number for a separation that has not counted its segments yet", () => {
      const status = describeSeparation(state({ status: "processing", stage: "separating", processed: 0, total: 0 }));
      expect(separationText(status)).toBe("Separating");
      expect(separationFill(status)).toBe(0);
    });

    it("shows no number for a download whose fraction is not yet finite", () => {
      const status = describeSeparation(
        state({ status: "waiting-for-capture", downloadSource: "hidden-player", downloadFraction: Number.NaN })
      );
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
        const fill = separationFill(
          describeSeparation(state({ status: "processing", stage: "separating", processed, total }))
        );
        expect(fill).toBeGreaterThanOrEqual(0);
        expect(fill).toBeLessThanOrEqual(1);
      }
    });

    it("describes every status the state machine can hold", () => {
      const statuses = ["waiting-for-capture", "ready-to-engage", "processing", "engaged", "failed"] as const;
      for (const status of statuses) {
        expect(describeSeparation(state({ status }))).not.toBeNull();
      }
    });
  });

  describe("regressions", () => {
    it("regression: Ready never renders as a percentage", () => {
      expect(separationText(describeSeparation(state({ status: "engaged" })))).not.toContain("%");
    });

    it("regression: an overshooting segment count still reads as at most 100%", () => {
      const status = describeSeparation(state({ status: "processing", stage: "separating", processed: 9, total: 8 }));
      expect(separationText(status)).toBe("Separating 100%");
    });

    it("regression: Finishing holds the bar where separating left it instead of sweeping back to nothing", () => {
      const separating = state({ status: "processing", stage: "separating", processed: 19, total: 20 });
      const finishing = { ...separating, stage: "encoding" };
      expect(separationText(describeSeparation(finishing))).toBe("Finishing");
      expect(separationFill(describeSeparation(finishing))).toBe(separationFill(describeSeparation(separating)));
    });

    it("regression: the bar never runs backwards across a whole track", () => {
      const run: KaraokeState[] = [
        state({ status: "waiting-for-capture" }),
        state({ status: "waiting-for-capture", downloadSource: "hidden-player", downloadFraction: 0.2 }),
        state({ status: "waiting-for-capture", downloadSource: "hidden-player", downloadFraction: 0.9 }),
        state({ status: "processing", stage: "checking-cache" }),
        state({ status: "processing", stage: "decoding" }),
        state({ status: "processing", stage: "downloading-model" }),
        state({ status: "processing", stage: "separating", processed: 1, total: 20 }),
        state({ status: "processing", stage: "separating", processed: 19, total: 20 }),
        state({ status: "processing", stage: "encoding", processed: 19, total: 20 }),
        state({ status: "engaged", processed: 19, total: 20 }),
      ];
      const fills = run.map(step => separationFill(describeSeparation(step)));
      for (let index = 1; index < fills.length; index++) {
        expect(fills[index]).toBeGreaterThanOrEqual(fills[index - 1]);
      }
      expect(fills.at(-1)).toBe(1);
    });

    it("regression: the download's percentage stays in the text and out of the bar", () => {
      const status = describeSeparation(
        state({ status: "waiting-for-capture", downloadSource: "hidden-player", downloadFraction: 0.67 })
      );
      expect(separationText(status)).toBe("Downloading track 67%");
      expect(separationFill(status)).toBe(0);
    });
  });
});
