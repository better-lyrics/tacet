import { describe, expect, it } from "vitest";
import { frameTrackDuration } from "@/capture/frame-duration";

describe("frameTrackDuration", () => {
  it("takes the player's answer when it has one", () => {
    expect(frameTrackDuration(215, 215)).toBe(215);
  });

  it("falls back to the element before the player is ready", () => {
    expect(frameTrackDuration(0, 215)).toBe(215);
  });

  describe("regressions", () => {
    it("regression: during a preroll ad the player knows the track and the element does not", () => {
      expect(frameTrackDuration(215, 20)).toBe(215);
    });

    it("regression: the player reports 0 for a beat after the frame loads", () => {
      expect(frameTrackDuration(0, 20)).toBe(20);
    });
  });

  describe("edge cases", () => {
    it("rejects every unusable player reading", () => {
      for (const player of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
        expect(frameTrackDuration(player, 180)).toBe(180);
      }
    });

    it("is zero when neither is usable", () => {
      expect(frameTrackDuration(Number.NaN, Number.NaN)).toBe(0);
      expect(frameTrackDuration(0, 0)).toBe(0);
      expect(frameTrackDuration(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
    });
  });

  describe("invariants", () => {
    it("never returns a value neither source offered", () => {
      for (const player of [Number.NaN, 0, 20, 215]) {
        for (const element of [Number.NaN, 0, 20, 215]) {
          const result = frameTrackDuration(player, element);
          expect(result === player || result === element || result === 0).toBe(true);
        }
      }
    });

    it("never returns a negative or non-finite length", () => {
      for (const player of [Number.NaN, Number.NEGATIVE_INFINITY, -5, 0, 215]) {
        for (const element of [Number.NaN, Number.NEGATIVE_INFINITY, -5, 0, 215]) {
          const result = frameTrackDuration(player, element);
          expect(Number.isFinite(result) && result >= 0).toBe(true);
        }
      }
    });
  });
});
