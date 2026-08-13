import { SEGMENT_SAMPLES } from "@/separation/chunker";
import { buildWaveformTensorData } from "@/separation/waveform-tensor";
import { describe, expect, it } from "vitest";

// -- Test helpers -----------------------------------------------------------------

function makeChannel(fillValue: number): Float32Array {
  return new Float32Array(SEGMENT_SAMPLES).fill(fillValue);
}

// -- Tests -----------------------------------------------------------------

describe("buildWaveformTensorData", () => {
  it("lays out [L..., R...] with length 2 * SEGMENT_SAMPLES", () => {
    const left = makeChannel(0.25);
    const right = makeChannel(-0.5);
    const flat = buildWaveformTensorData([left, right]);

    expect(flat.length).toBe(2 * SEGMENT_SAMPLES);
    expect(flat[0]).toBe(0.25);
    expect(flat[SEGMENT_SAMPLES - 1]).toBe(0.25);
    expect(flat[SEGMENT_SAMPLES]).toBe(-0.5);
    expect(flat[2 * SEGMENT_SAMPLES - 1]).toBe(-0.5);
  });

  it("preserves per-sample values exactly, not just fill values", () => {
    const left = new Float32Array(SEGMENT_SAMPLES);
    const right = new Float32Array(SEGMENT_SAMPLES);
    for (let i = 0; i < SEGMENT_SAMPLES; i++) {
      left[i] = i / SEGMENT_SAMPLES;
      right[i] = -(i / SEGMENT_SAMPLES);
    }
    const flat = buildWaveformTensorData([left, right]);

    expect(flat.subarray(0, SEGMENT_SAMPLES).every((value, index) => value === left[index])).toBe(true);
    expect(flat.subarray(SEGMENT_SAMPLES, 2 * SEGMENT_SAMPLES).every((value, index) => value === right[index])).toBe(
      true
    );
  });

  it("does not mutate the input channels", () => {
    const left = makeChannel(1);
    const right = makeChannel(2);
    buildWaveformTensorData([left, right]);

    expect(left.every(v => v === 1)).toBe(true);
    expect(right.every(v => v === 2)).toBe(true);
  });

  describe("error paths", () => {
    it("throws for mono input", () => {
      expect(() => buildWaveformTensorData([makeChannel(0)])).toThrow(/stereo/i);
    });

    it("throws for more than 2 channels", () => {
      expect(() => buildWaveformTensorData([makeChannel(0), makeChannel(0), makeChannel(0)])).toThrow(/stereo/i);
    });

    it("throws when a channel is shorter than SEGMENT_SAMPLES", () => {
      expect(() => buildWaveformTensorData([new Float32Array(SEGMENT_SAMPLES - 1), makeChannel(0)])).toThrow(
        /SEGMENT_SAMPLES/
      );
    });

    it("throws when a channel is longer than SEGMENT_SAMPLES", () => {
      expect(() => buildWaveformTensorData([new Float32Array(SEGMENT_SAMPLES + 1), makeChannel(0)])).toThrow(
        /SEGMENT_SAMPLES/
      );
    });
  });
});
