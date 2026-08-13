import { describe, expect, it } from "vitest";
import { FRAME_SECONDS, chooseSwapDelaySeconds } from "@/pageworld/swap-window";

const FRAME = FRAME_SECONDS;

// One entry per FRAME_SECONDS, so `loud(50)` is a second of loud music.
const loud = (frames: number): number[] => new Array(frames).fill(0.3);
const quiet = (frames: number): number[] => new Array(frames).fill(0.01);

function delayFor(envelope: number[], fromSeconds: number, fadeSeconds = 0.25, withinSeconds = 2): number {
  return chooseSwapDelaySeconds({ envelope, frameSeconds: FRAME, fromSeconds, withinSeconds, fadeSeconds });
}

describe("chooseSwapDelaySeconds", () => {
  it("waits for a quiet passage inside the search window", () => {
    // Loud for half a second, then quiet.
    const envelope = [...loud(25), ...quiet(50), ...loud(50)];
    expect(delayFor(envelope, 0)).toBeCloseTo(25 * FRAME, 5);
  });

  it("does not wait when the music is uniformly loud", () => {
    expect(delayFor(loud(200), 0)).toBe(0);
  });

  it("does not wait when it is already in the quiet part", () => {
    const envelope = [...quiet(50), ...loud(100)];
    expect(delayFor(envelope, 0)).toBe(0);
  });

  it("measures the delay from where the playhead actually is", () => {
    const envelope = [...loud(50), ...quiet(50), ...loud(50)];
    expect(delayFor(envelope, 25 * FRAME)).toBeCloseTo(25 * FRAME, 5);
  });

  describe("edge cases", () => {
    it("never waits longer than the search window allows", () => {
      const envelope = [...loud(200), ...quiet(50)];
      const delay = delayFor(envelope, 0, 0.25, 1);
      expect(delay).toBeLessThanOrEqual(1 + 0.25);
    });

    it("answers now for an envelope too short to hold the fade", () => {
      expect(delayFor(quiet(3), 0, 0.25)).toBe(0);
    });

    it("answers now for unusable inputs rather than a negative delay", () => {
      const envelope = [...loud(25), ...quiet(50)];
      expect(
        chooseSwapDelaySeconds({ envelope, frameSeconds: 0, fromSeconds: 0, withinSeconds: 2, fadeSeconds: 0.25 })
      ).toBe(0);
      expect(delayFor(envelope, Number.NaN)).toBe(0);
      expect(delayFor(envelope, 0, Number.NaN)).toBe(0);
      expect(delayFor(envelope, 0, 0.25, 0)).toBe(0);
    });

    it("answers now for a silent track, where no window beats any other", () => {
      expect(delayFor(quiet(200), 0)).toBe(0);
    });

    it("finds a quiet window on a quiet track, judging against its neighbours", () => {
      // A quiet track with a near-silent gap. An absolute threshold would miss
      // this, and a relative one should not.
      const envelope = [...new Array(25).fill(0.02), ...new Array(50).fill(0.0005), ...new Array(50).fill(0.02)];
      expect(delayFor(envelope, 0)).toBeCloseTo(25 * FRAME, 5);
    });
  });

  describe("invariants", () => {
    it("never answers a delay that runs past the search window plus the fade", () => {
      const envelope = [...loud(30), ...quiet(20), ...loud(30), ...quiet(60)];
      for (let within = 0.5; within <= 3; within += 0.25) {
        const delay = chooseSwapDelaySeconds({
          envelope,
          frameSeconds: FRAME,
          fromSeconds: 0,
          withinSeconds: within,
          fadeSeconds: 0.25,
        });
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(within + 0.25);
      }
    });

    it("picks the quieter of two candidate windows", () => {
      const envelope = [...loud(10), ...new Array(20).fill(0.1), ...loud(10), ...new Array(20).fill(0.01), ...loud(40)];
      expect(delayFor(envelope, 0, 0.25, 2)).toBeCloseTo(40 * FRAME, 5);
    });
  });

  describe("regressions", () => {
    it("regression: a fade longer than the quiet gap does not pick that gap", () => {
      // A 0.1s gap cannot hold a 0.5s fade, so the surrounding music would play
      // through most of it and the artifact would be as loud as ever.
      const envelope = [...loud(25), ...quiet(5), ...loud(120)];
      expect(delayFor(envelope, 0, 0.5, 2)).toBe(0);
    });
  });
});
