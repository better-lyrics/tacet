import { decideCrossfade } from "@/automix/crossfade-gate";
import type { CrossfadeGateInput } from "@/automix/crossfade-gate";
import { describe, expect, it } from "vitest";

const ready: CrossfadeGateInput = {
  crossfading: false,
  bypassed: false,
  outgoingPlaying: true,
  durationSeconds: 16,
};

describe("decideCrossfade", () => {
  it("allows a crossfade when a deck is playing and nothing is in flight", () => {
    expect(decideCrossfade(ready)).toEqual({ kind: "allow" });
  });

  describe("edge cases", () => {
    it("refuses a second crossfade while one is in flight", () => {
      const gate = decideCrossfade({ ...ready, crossfading: true });
      expect(gate.kind).toBe("refuse");
      expect(gate).toMatchObject({ reason: expect.stringContaining("already in flight") });
    });

    it("refuses while the graph is bypassed to the original", () => {
      expect(decideCrossfade({ ...ready, bypassed: true }).kind).toBe("refuse");
    });

    it("refuses when nothing is playing to fade out of", () => {
      expect(decideCrossfade({ ...ready, outgoingPlaying: false }).kind).toBe("refuse");
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses a duration of %s", duration => {
      expect(decideCrossfade({ ...ready, durationSeconds: duration }).kind).toBe("refuse");
    });

    it("allows a very short but positive duration", () => {
      expect(decideCrossfade({ ...ready, durationSeconds: 0.01 }).kind).toBe("allow");
    });
  });

  describe("invariants", () => {
    it("reports in-flight before every other reason, since it is the least recoverable", () => {
      const gate = decideCrossfade({
        crossfading: true,
        bypassed: true,
        outgoingPlaying: false,
        durationSeconds: -1,
      });
      expect(gate).toMatchObject({ reason: expect.stringContaining("already in flight") });
    });

    it("always explains itself when it refuses", () => {
      const refusals: CrossfadeGateInput[] = [
        { ...ready, crossfading: true },
        { ...ready, bypassed: true },
        { ...ready, outgoingPlaying: false },
        { ...ready, durationSeconds: 0 },
      ];
      for (const input of refusals) {
        const gate = decideCrossfade(input);
        if (gate.kind !== "refuse") throw new Error("expected a refusal");
        expect(gate.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe("regressions", () => {
    it("regression: an infinite duration is refused, not passed to setValueCurveAtTime", () => {
      expect(decideCrossfade({ ...ready, durationSeconds: Number.POSITIVE_INFINITY }).kind).toBe("refuse");
    });
  });
});
