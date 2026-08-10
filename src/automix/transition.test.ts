import { barsToSeconds, equalPowerCurve, planTransition } from "@/automix/transition";
import type { TransitionPlan } from "@/automix/transition";
import { describe, expect, it } from "vitest";

describe("barsToSeconds", () => {
  it.each([
    [8, 120, 16],
    [8, 128, 15],
    [4, 120, 8],
    [1, 60, 4],
  ])("%s bars at %s bpm is %s seconds", (bars, bpm, expected) => {
    expect(barsToSeconds(bars, bpm)).toBeCloseTo(expected, 6);
  });

  it("honours a time signature other than four four", () => {
    expect(barsToSeconds(8, 120, 3)).toBeCloseTo(12, 6);
  });

  describe("edge cases", () => {
    it("rejects a tempo of zero rather than returning Infinity", () => {
      expect(() => barsToSeconds(8, 0)).toThrow(/bpm/);
    });

    it("rejects a negative tempo", () => {
      expect(() => barsToSeconds(8, -120)).toThrow(/bpm/);
    });

    it("rejects a non-finite tempo", () => {
      expect(() => barsToSeconds(8, Number.NaN)).toThrow(/bpm/);
    });

    it("returns zero for zero bars", () => {
      expect(barsToSeconds(0, 120)).toBe(0);
    });
  });

  describe("invariants", () => {
    it("is linear in bars", () => {
      expect(barsToSeconds(16, 120)).toBeCloseTo(2 * barsToSeconds(8, 120), 6);
    });

    it("halves when the tempo doubles", () => {
      expect(barsToSeconds(8, 240)).toBeCloseTo(barsToSeconds(8, 120) / 2, 6);
    });
  });
});

describe("equalPowerCurve", () => {
  it("fades out from full to silent", () => {
    const curve = equalPowerCurve(64, "out");
    expect(curve[0]).toBeCloseTo(1, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 6);
  });

  it("fades in from silent to full", () => {
    const curve = equalPowerCurve(64, "in");
    expect(curve[0]).toBeCloseTo(0, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 6);
  });

  it("is a Float32Array of the requested length", () => {
    const curve = equalPowerCurve(37, "in");
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve.length).toBe(37);
  });

  describe("invariants", () => {
    it("holds constant power against its opposite at every step", () => {
      const steps = 128;
      const rising = equalPowerCurve(steps, "in");
      const falling = equalPowerCurve(steps, "out");
      for (let i = 0; i < steps; i++) {
        expect(rising[i] ** 2 + falling[i] ** 2).toBeCloseTo(1, 5);
      }
    });

    it("crosses at the square root of a half, not at a half", () => {
      const steps = 129;
      const rising = equalPowerCurve(steps, "in");
      const falling = equalPowerCurve(steps, "out");
      const middle = (steps - 1) / 2;
      expect(rising[middle]).toBeCloseTo(Math.SQRT1_2, 5);
      expect(falling[middle]).toBeCloseTo(Math.SQRT1_2, 5);
    });

    it("never dips below the linear crossfade's midpoint sum", () => {
      const steps = 128;
      const rising = equalPowerCurve(steps, "in");
      const falling = equalPowerCurve(steps, "out");
      for (let i = 0; i < steps; i++) {
        expect(rising[i] + falling[i]).toBeGreaterThanOrEqual(1);
      }
    });

    it("is monotonic in both directions", () => {
      const rising = equalPowerCurve(64, "in");
      const falling = equalPowerCurve(64, "out");
      for (let i = 1; i < 64; i++) {
        expect(rising[i]).toBeGreaterThanOrEqual(rising[i - 1]);
        expect(falling[i]).toBeLessThanOrEqual(falling[i - 1]);
      }
    });

    it("stays inside the unit range", () => {
      for (const direction of ["in", "out"] as const) {
        for (const value of equalPowerCurve(256, direction)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("edge cases", () => {
    it("rejects fewer than two steps, which cannot express a ramp", () => {
      expect(() => equalPowerCurve(1, "in")).toThrow(/steps/);
      expect(() => equalPowerCurve(0, "out")).toThrow(/steps/);
    });

    it("rejects a non-integer step count", () => {
      expect(() => equalPowerCurve(12.5, "in")).toThrow(/steps/);
    });

    it("supports the minimum of two steps", () => {
      expect(Array.from(equalPowerCurve(2, "in"))).toEqual([0, 1]);
    });
  });
});

function expectStart(plan: TransitionPlan): Extract<TransitionPlan, { kind: "start" }> {
  if (plan.kind !== "start") throw new Error(`expected a planned transition, got refused: ${plan.reason}`);
  return plan;
}

describe("planTransition", () => {
  it("starts the window one transition length before the track ends", () => {
    const plan = expectStart(planTransition({ outgoingDurationSeconds: 214, outgoingBpm: 120, bars: 8 }));
    expect(plan.durationSeconds).toBeCloseTo(16, 6);
    expect(plan.startSeconds).toBeCloseTo(198, 6);
  });

  it("measures the window in bars, so a faster track gets a shorter one", () => {
    const slow = expectStart(planTransition({ outgoingDurationSeconds: 200, outgoingBpm: 90, bars: 8 }));
    const fast = expectStart(planTransition({ outgoingDurationSeconds: 200, outgoingBpm: 174, bars: 8 }));
    expect(fast.durationSeconds).toBeLessThan(slow.durationSeconds);
  });

  it("defaults to an eight bar window", () => {
    const explicit = expectStart(planTransition({ outgoingDurationSeconds: 214, outgoingBpm: 120, bars: 8 }));
    const defaulted = expectStart(planTransition({ outgoingDurationSeconds: 214, outgoingBpm: 120 }));
    expect(defaulted.durationSeconds).toBe(explicit.durationSeconds);
  });

  describe("edge cases", () => {
    it("refuses a track shorter than the window it would need", () => {
      const plan = planTransition({ outgoingDurationSeconds: 10, outgoingBpm: 120, bars: 8 });
      expect(plan.kind).toBe("refused");
    });

    it("refuses rather than planning a negative start", () => {
      const plan = planTransition({ outgoingDurationSeconds: 16, outgoingBpm: 120, bars: 8 });
      expect(plan.kind).toBe("refused");
    });

    it("rejects a non-finite duration", () => {
      expect(() => planTransition({ outgoingDurationSeconds: Number.NaN, outgoingBpm: 120, bars: 8 })).toThrow(
        /duration/
      );
    });
  });

  describe("regressions", () => {
    it("regression: the window always ends exactly at the stated track end, never past it", () => {
      const plan = expectStart(planTransition({ outgoingDurationSeconds: 49.9, outgoingBpm: 120, bars: 8 }));
      expect(plan.startSeconds).toBeGreaterThan(0);
      expect(plan.startSeconds + plan.durationSeconds).toBeCloseTo(49.9, 6);
    });
  });
});
