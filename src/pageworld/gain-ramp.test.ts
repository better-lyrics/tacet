import { describe, expect, it } from "vitest";
import { GAIN_RAMP_SECONDS, rampGainFromZero, rampGainTo, scheduleGainCurve } from "@/pageworld/gain-ramp";

type Call = [string, ...number[]];

function recordingParam(value = 1): AudioParam & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    value,
    calls,
    cancelAndHoldAtTime(at: number) {
      calls.push(["cancelAndHoldAtTime", at]);
      return this;
    },
    setValueAtTime(next: number, at: number) {
      calls.push(["setValueAtTime", next, at]);
      return this;
    },
    linearRampToValueAtTime(next: number, at: number) {
      calls.push(["linearRampToValueAtTime", next, at]);
      return this;
    },
    setValueCurveAtTime(_curve: Float32Array, at: number, duration: number) {
      calls.push(["setValueCurveAtTime", at, duration]);
      return this;
    },
  } as unknown as AudioParam & { calls: Call[] };
}

const context = { currentTime: 100 } as BaseAudioContext;

describe("rampGainTo", () => {
  it("ramps to the value over the time asked for", () => {
    const param = recordingParam(1);
    rampGainTo(param, context, 0, 0.3);
    expect(param.calls.at(-1)).toEqual(["linearRampToValueAtTime", 0, 100.3]);
  });

  it("steps when given no time to ramp over", () => {
    const param = recordingParam(1);
    rampGainTo(param, context, 0, 0);
    expect(param.calls).toEqual([
      ["cancelAndHoldAtTime", 100],
      ["setValueAtTime", 0, 100],
    ]);
  });

  it("defaults to the shared ramp length", () => {
    const param = recordingParam(1);
    rampGainTo(param, context, 0);
    expect(param.calls.at(-1)).toEqual(["linearRampToValueAtTime", 0, 100 + GAIN_RAMP_SECONDS]);
  });

  describe("regressions", () => {
    it("regression: anchors the ramp at now, so it starts from where the gain is", () => {
      const param = recordingParam(0.8);
      rampGainTo(param, context, 0, 0.3);
      expect(param.calls).toEqual([
        ["cancelAndHoldAtTime", 100],
        ["setValueAtTime", 0.8, 100],
        ["linearRampToValueAtTime", 0, 100.3],
      ]);
    });

    it("regression: the anchor is written after the cancel, never before it", () => {
      const param = recordingParam(0.5);
      rampGainTo(param, context, 1, 0.3);
      const cancelled = param.calls.findIndex(call => call[0] === "cancelAndHoldAtTime");
      const anchored = param.calls.findIndex(call => call[0] === "setValueAtTime");
      expect(cancelled).toBeGreaterThanOrEqual(0);
      expect(anchored).toBeGreaterThan(cancelled);
    });

    it("regression: the anchor reads the gain before the cancel disturbs it", () => {
      const param = recordingParam(0.42);
      rampGainTo(param, context, 1, 0.3);
      expect(param.calls[1]).toEqual(["setValueAtTime", 0.42, 100]);
    });
  });
});

describe("rampGainFromZero", () => {
  it("anchors at zero and ramps to full", () => {
    const param = recordingParam(0.3);
    rampGainFromZero(param, context, 0.25);
    expect(param.calls).toEqual([
      ["cancelAndHoldAtTime", 100],
      ["setValueAtTime", 0, 100],
      ["linearRampToValueAtTime", 1, 100.25],
    ]);
  });

  it("falls back to the shared ramp length for an unusable duration", () => {
    const param = recordingParam(0);
    rampGainFromZero(param, context, 0);
    expect(param.calls.at(-1)).toEqual(["linearRampToValueAtTime", 1, 100 + GAIN_RAMP_SECONDS]);
  });
});

describe("scheduleGainCurve", () => {
  it("cancels before scheduling, because a curve over a live ramp throws", () => {
    const param = recordingParam(1);
    scheduleGainCurve(param, context, new Float32Array([0, 1]), 101, 2);
    expect(param.calls).toEqual([
      ["cancelAndHoldAtTime", 100],
      ["setValueCurveAtTime", 101, 2],
    ]);
  });
});
