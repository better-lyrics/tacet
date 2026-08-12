import { describe, expect, it } from "vitest";
import { frameTrackDuration, settledFrameDuration } from "@/capture/frame-duration";

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

describe("settledFrameDuration", () => {
  it("answers the track's duration when nothing is in the way", () => {
    expect(settledFrameDuration(false, 188.3, 15)).toBeCloseTo(188.3, 6);
  });

  it("refuses to answer while an advertisement plays", () => {
    expect(settledFrameDuration(true, 15.04, 15.04)).toBe(0);
  });

  describe("edge cases", () => {
    it("falls back to the element when the player has no duration yet", () => {
      expect(settledFrameDuration(false, 0, 188.3)).toBeCloseTo(188.3, 6);
      expect(settledFrameDuration(false, Number.NaN, 188.3)).toBeCloseTo(188.3, 6);
    });

    it("answers zero when neither clock is readable", () => {
      expect(settledFrameDuration(false, Number.NaN, Number.NaN)).toBe(0);
      expect(settledFrameDuration(false, 0, 0)).toBe(0);
    });

    it("refuses during an advertisement even when both clocks read cleanly", () => {
      expect(settledFrameDuration(true, 200, 200)).toBe(0);
    });
  });

  describe("regressions", () => {
    it("regression: a preroll's own length is never mistaken for the track's", () => {
      const advertisementSeconds = 15.041;
      expect(settledFrameDuration(true, advertisementSeconds, advertisementSeconds)).toBe(0);
      expect(settledFrameDuration(false, 188.321, advertisementSeconds)).toBeCloseTo(188.321, 6);
    });
  });
});
