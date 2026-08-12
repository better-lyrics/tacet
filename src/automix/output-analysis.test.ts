import { CLICK_FLOOR, analyseOutput, compareEnvelope, predictedCrossfadeEnvelope } from "@/automix/output-analysis";
import { describe, expect, it } from "vitest";

const SR = 48000;

function tone(seconds: number, hz: number, amp = 0.25): Float32Array {
  const n = Math.floor(SR * seconds);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.sin(2 * Math.PI * hz * (i / SR)) * amp;
  return data;
}

function noise(seconds: number, amp = 0.25, seed = 1): Float32Array {
  let s = seed >>> 0;
  const n = Math.floor(SR * seconds);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = ((s / 0xffffffff) * 2 - 1) * amp;
  }
  return data;
}

describe("analyseOutput", () => {
  it("reports a clean tone as clean", () => {
    const result = analyseOutput(tone(1, 440), SR);
    expect(result.nonFinite).toBe(0);
    expect(result.clipped).toBe(0);
    expect(result.clicks).toBe(0);
    expect(result.peak).toBeCloseTo(0.25, 2);
    expect(result.rms).toBeCloseTo(0.25 / Math.SQRT2, 2);
    expect(result.dcOffset).toBeCloseTo(0, 3);
  });

  it("counts samples above full scale as clipped", () => {
    const loud = tone(0.5, 440, 1.4);
    const result = analyseOutput(loud, SR);
    expect(result.clipped).toBeGreaterThan(0);
    expect(result.peak).toBeCloseTo(1.4, 2);
  });

  it("finds a single injected discontinuity and locates it", () => {
    const samples = tone(1, 220);
    samples[24000] = 0.9;
    const result = analyseOutput(samples, SR);
    expect(result.clicks).toBeGreaterThan(0);
    expect(result.maxDeltaAtSeconds).toBeCloseTo(24000 / SR, 2);
  });

  it("finds a silent gap and reports its length", () => {
    const samples = tone(2, 220);
    samples.fill(0, SR, SR + SR / 2);
    const result = analyseOutput(samples, SR);
    expect(result.longestSilenceMs).toBeCloseTo(500, 0);
  });

  it("counts non-finite samples without letting them poison the statistics", () => {
    const samples = tone(1, 220);
    samples[100] = Number.NaN;
    samples[200] = Number.POSITIVE_INFINITY;
    const result = analyseOutput(samples, SR);
    expect(result.nonFinite).toBe(2);
    expect(Number.isFinite(result.rms)).toBe(true);
    expect(Number.isFinite(result.peak)).toBe(true);
  });

  describe("edge cases", () => {
    it("returns a zeroed analysis for an empty buffer", () => {
      const result = analyseOutput(new Float32Array(0), SR);
      expect(result.frames).toBe(0);
      expect(result.clicks).toBe(0);
      expect(result.envelope).toEqual([]);
    });

    it.each([0, -1, Number.NaN])("returns a zeroed analysis for a sample rate of %s", rate => {
      expect(analyseOutput(tone(1, 220), rate).frames).toBe(0);
    });

    it("handles a single sample without dividing by zero", () => {
      const result = analyseOutput(Float32Array.from([0.5]), SR);
      expect(result.frames).toBe(1);
      expect(result.peak).toBe(0.5);
      expect(result.clicks).toBe(0);
      expect(Number.isNaN(result.maxDeltaAtSeconds)).toBe(true);
    });

    it("reports pure silence as one long gap rather than as a defect count", () => {
      const result = analyseOutput(new Float32Array(SR), SR);
      expect(result.longestSilenceMs).toBeCloseTo(1000, 0);
      expect(result.clicks).toBe(0);
      expect(result.peak).toBe(0);
    });

    it("never reports a click below the floor, whatever the material", () => {
      const veryQuiet = tone(1, 220, 1e-6);
      const result = analyseOutput(veryQuiet, SR);
      expect(result.clickThreshold).toBeGreaterThanOrEqual(CLICK_FLOOR);
      expect(result.clicks).toBe(0);
    });

    it("measures a DC offset rather than hiding it in the RMS", () => {
      const offset = tone(1, 220);
      for (let i = 0; i < offset.length; i++) offset[i] += 0.1;
      const result = analyseOutput(offset, SR);
      expect(result.dcOffset).toBeCloseTo(0.1, 3);
    });
  });

  describe("invariants", () => {
    it("does not call bright but continuous material a defect", () => {
      for (const hz of [220, 440, 1000, 4000, 12000]) {
        const result = analyseOutput(tone(1, hz, 0.9), SR);
        expect(`${hz}:${result.clicks}`).toBe(`${hz}:0`);
      }
    });

    it("does not call white noise a string of clicks, though every sample jumps", () => {
      const result = analyseOutput(noise(2, 0.25, 5), SR);
      expect(result.clicks).toBe(0);
    });

    it("peak is never below RMS", () => {
      for (const samples of [tone(1, 440), noise(1, 0.3, 9), new Float32Array(128).fill(0.2)]) {
        const result = analyseOutput(samples, SR);
        expect(result.peak).toBeGreaterThanOrEqual(result.rms - 1e-6);
      }
    });

    it("the envelope covers the buffer to within one window", () => {
      const result = analyseOutput(tone(2, 440), SR, 0.05);
      expect(result.envelope.length).toBe(Math.floor(2 / 0.05));
    });
  });

  describe("regressions", () => {
    it("regression: NaN is counted, not silently averaged, since it reaches the listener as silence", () => {
      const allNaN = new Float32Array(1000).fill(Number.NaN);
      const result = analyseOutput(allNaN, SR);
      expect(result.nonFinite).toBe(1000);
      expect(result.rms).toBe(0);
    });
  });
});

describe("predictedCrossfadeEnvelope", () => {
  it("holds constant power when both tracks are the same loudness", () => {
    const predicted = predictedCrossfadeEnvelope(0.2, 0.2, 64);
    for (const value of predicted) expect(value).toBeCloseTo(0.2, 6);
  });

  it("interpolates between two different loudnesses", () => {
    const predicted = predictedCrossfadeEnvelope(0.4, 0.1, 3);
    expect(predicted[0]).toBeCloseTo(0.4, 6);
    expect(predicted[2]).toBeCloseTo(0.1, 6);
    expect(predicted[1]).toBeCloseTo(Math.hypot(0.4 * Math.SQRT1_2, 0.1 * Math.SQRT1_2), 6);
  });

  it("returns the starting level for a single window rather than dividing by zero", () => {
    expect(predictedCrossfadeEnvelope(0.3, 0.1, 1)).toEqual([0.3]);
  });
});

describe("compareEnvelope", () => {
  it("reports no deviation when the measured envelope matches", () => {
    const predicted = predictedCrossfadeEnvelope(0.2, 0.3, 32);
    const result = compareEnvelope(predicted, predicted);
    expect(result.worstUnder).toBeCloseTo(1, 6);
    expect(result.worstOver).toBeCloseTo(1, 6);
    expect(result.compared).toBe(32);
  });

  it("reports the worst dip and the worst bump", () => {
    const predicted = new Array(8).fill(0.2);
    const measured = [...predicted];
    measured[3] = 0.1;
    measured[6] = 0.26;
    const result = compareEnvelope(measured, predicted);
    expect(result.worstUnder).toBeCloseTo(0.5, 6);
    expect(result.worstOver).toBeCloseTo(1.3, 6);
  });

  it("skips windows where nothing was predicted, rather than dividing by them", () => {
    const result = compareEnvelope([0.2, 0.2], [0, 0.2]);
    expect(result.compared).toBe(1);
    expect(result.worstUnder).toBeCloseTo(1, 6);
  });

  it("compares only the overlap when the two lists differ in length", () => {
    expect(compareEnvelope([0.2, 0.2, 0.2], [0.2]).compared).toBe(1);
  });
});
