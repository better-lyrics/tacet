import { SILENCE_RMS, decideCrossfade, judgeIncomingStems } from "@/automix/crossfade-gate";
import type { CrossfadeGateInput, IncomingStems } from "@/automix/crossfade-gate";
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

// -- judgeIncomingStems -------------------------------------------------------

const healthy: IncomingStems = {
  durationSeconds: 214,
  vocalsRms: 0.041,
  instrumentalRms: 0.113,
  fadeSeconds: 8,
};

describe("judgeIncomingStems", () => {
  it("allows real separated stems", () => {
    expect(judgeIncomingStems(healthy)).toEqual({ kind: "allow" });
  });

  describe("edge cases", () => {
    it("refuses stems shorter than the fade, which render as a fade into silence", () => {
      const gate = judgeIncomingStems({ ...healthy, durationSeconds: 3 });
      expect(gate.kind).toBe("refuse");
      expect(gate).toMatchObject({ reason: expect.stringContaining("shorter") });
    });

    it("allows stems exactly as long as the fade", () => {
      expect(judgeIncomingStems({ ...healthy, durationSeconds: 8 }).kind).toBe("allow");
    });

    it.each([0, -1, Number.NaN])("refuses a duration of %s", durationSeconds => {
      expect(judgeIncomingStems({ ...healthy, durationSeconds }).kind).toBe("refuse");
    });

    it("refuses stems that are silent in both halves", () => {
      const gate = judgeIncomingStems({ ...healthy, vocalsRms: 0, instrumentalRms: 0 });
      expect(gate).toMatchObject({ reason: expect.stringContaining("silent") });
    });

    it("allows a silent vocals stem, since a fully instrumental track is legitimate", () => {
      expect(judgeIncomingStems({ ...healthy, vocalsRms: 0 }).kind).toBe("allow");
    });

    it("allows a silent instrumental stem, since an a cappella track is legitimate", () => {
      expect(judgeIncomingStems({ ...healthy, instrumentalRms: 0 }).kind).toBe("allow");
    });

    it("treats anything under the silence floor as silence", () => {
      const hair = SILENCE_RMS / 2;
      expect(judgeIncomingStems({ ...healthy, vocalsRms: hair, instrumentalRms: hair }).kind).toBe("refuse");
      expect(judgeIncomingStems({ ...healthy, vocalsRms: SILENCE_RMS, instrumentalRms: hair }).kind).toBe("allow");
    });

    it("refuses a NaN measurement rather than trusting it", () => {
      expect(judgeIncomingStems({ ...healthy, vocalsRms: Number.NaN }).kind).toBe("refuse");
      expect(judgeIncomingStems({ ...healthy, instrumentalRms: Number.NaN }).kind).toBe("refuse");
    });
  });

  describe("invariants", () => {
    it("always explains itself when it refuses", () => {
      const refusals: IncomingStems[] = [
        { ...healthy, durationSeconds: 1 },
        { ...healthy, durationSeconds: 0 },
        { ...healthy, vocalsRms: 0, instrumentalRms: 0 },
        { ...healthy, vocalsRms: Number.NaN },
      ];
      for (const input of refusals) {
        const gate = judgeIncomingStems(input);
        if (gate.kind !== "refuse") throw new Error("expected a refusal");
        expect(gate.reason.length).toBeGreaterThan(0);
      }
    });

    it("a longer fade only ever narrows what it allows", () => {
      for (const fadeSeconds of [4, 8, 12, 20]) {
        const gate = judgeIncomingStems({ ...healthy, durationSeconds: 10, fadeSeconds });
        expect(gate.kind).toBe(fadeSeconds <= 10 ? "allow" : "refuse");
      }
    });
  });

  describe("regressions", () => {
    it("regression: silent stems are refused rather than faded into, which measured as 6 s of silence", () => {
      expect(judgeIncomingStems({ ...healthy, vocalsRms: 0, instrumentalRms: 0 }).kind).toBe("refuse");
    });

    it("regression: a 3 s stem against an 8 s fade is refused, which measured as a dip to 3 %", () => {
      expect(judgeIncomingStems({ ...healthy, durationSeconds: 3, fadeSeconds: 8 }).kind).toBe("refuse");
    });
  });
});
