import { SILENCE_RMS, clampFadeToAudio, decideCrossfade, judgeIncomingStems } from "@/automix/crossfade-gate";
import type { CrossfadeGateInput, IncomingStems, OutgoingSource } from "@/automix/crossfade-gate";
import { describe, expect, it } from "vitest";

const ready: CrossfadeGateInput = {
  crossfading: false,
  outgoing: "deck",
  durationSeconds: 16,
};

const SOURCES: OutgoingSource[] = ["deck", "original", "none"];

describe("decideCrossfade", () => {
  it("allows a crossfade when a deck is playing and nothing is in flight", () => {
    expect(decideCrossfade(ready)).toEqual({ kind: "allow" });
  });

  it("allows a crossfade out of the unseparated original, which is the only source without stems", () => {
    expect(decideCrossfade({ ...ready, outgoing: "original" })).toEqual({ kind: "allow" });
  });

  describe("edge cases", () => {
    it("refuses a second crossfade while one is in flight", () => {
      const gate = decideCrossfade({ ...ready, crossfading: true });
      expect(gate.kind).toBe("refuse");
      expect(gate).toMatchObject({ reason: expect.stringContaining("already in flight") });
    });

    it("refuses when nothing is playing to fade out of", () => {
      expect(decideCrossfade({ ...ready, outgoing: "none" }).kind).toBe("refuse");
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
        outgoing: "none",
        durationSeconds: -1,
      });
      expect(gate).toMatchObject({ reason: expect.stringContaining("already in flight") });
    });

    it("always explains itself when it refuses", () => {
      const refusals: CrossfadeGateInput[] = [
        { ...ready, crossfading: true },
        { ...ready, outgoing: "none" },
        { ...ready, durationSeconds: 0 },
      ];
      for (const input of refusals) {
        const gate = decideCrossfade(input);
        if (gate.kind !== "refuse") throw new Error("expected a refusal");
        expect(gate.reason.length).toBeGreaterThan(0);
      }
    });

    it("refuses every source once a fade is already in flight", () => {
      for (const outgoing of SOURCES) {
        expect(decideCrossfade({ ...ready, outgoing, crossfading: true }).kind).toBe("refuse");
      }
    });

    it("judges only the source and never the presence of stems", () => {
      for (const outgoing of SOURCES) {
        const expected = outgoing === "none" ? "refuse" : "allow";
        expect(decideCrossfade({ ...ready, outgoing }).kind).toBe(expected);
      }
    });

    it("is a pure decision, since the cue asks it once per poll", () => {
      for (const outgoing of SOURCES) {
        const input: CrossfadeGateInput = { ...ready, outgoing };
        expect(decideCrossfade(input)).toEqual(decideCrossfade(input));
      }
    });
  });

  describe("regressions", () => {
    it("regression: an infinite duration is refused, not passed to setValueCurveAtTime", () => {
      expect(decideCrossfade({ ...ready, durationSeconds: Number.POSITIVE_INFINITY }).kind).toBe("refuse");
    });

    it("regression: a deck that ran out before the track did still fades, out of the original", () => {
      expect(decideCrossfade({ ...ready, outgoing: "original" }).kind).toBe("allow");
    });

    it("regression: being handed back to the original is no longer a refusal on its own", () => {
      expect(decideCrossfade({ crossfading: false, outgoing: "original", durationSeconds: 8 })).toEqual({
        kind: "allow",
      });
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

const mix: IncomingStems = {
  durationSeconds: 214,
  vocalsRms: null,
  instrumentalRms: 0.118,
  fadeSeconds: 8,
};

describe("judgeIncomingStems", () => {
  it("allows real separated stems", () => {
    expect(judgeIncomingStems(healthy)).toEqual({ kind: "allow" });
  });

  it("allows an unseparated mix, which has no vocals stem to measure", () => {
    expect(judgeIncomingStems(mix)).toEqual({ kind: "allow" });
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

    it("refuses a silent mix, since there is no vocals stem to carry it", () => {
      const gate = judgeIncomingStems({ ...mix, instrumentalRms: 0 });
      expect(gate).toMatchObject({ reason: expect.stringContaining("silent") });
    });

    it("holds a mix to the same silence floor", () => {
      expect(judgeIncomingStems({ ...mix, instrumentalRms: SILENCE_RMS / 2 }).kind).toBe("refuse");
      expect(judgeIncomingStems({ ...mix, instrumentalRms: SILENCE_RMS }).kind).toBe("allow");
    });

    it("refuses a mix measuring non-finite", () => {
      expect(judgeIncomingStems({ ...mix, instrumentalRms: Number.NaN }).kind).toBe("refuse");
    });

    it("refuses a mix shorter than the fade", () => {
      expect(judgeIncomingStems({ ...mix, durationSeconds: 3 }).kind).toBe("refuse");
    });
  });

  describe("invariants", () => {
    it("always explains itself when it refuses", () => {
      const refusals: IncomingStems[] = [
        { ...healthy, durationSeconds: 1 },
        { ...healthy, durationSeconds: 0 },
        { ...healthy, vocalsRms: 0, instrumentalRms: 0 },
        { ...healthy, vocalsRms: Number.NaN },
        { ...mix, instrumentalRms: 0 },
        { ...mix, instrumentalRms: Number.NaN },
        { ...mix, durationSeconds: 1 },
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

    it("judges a mix on its instrumental alone, exactly as it judges a stems pair with silent vocals", () => {
      for (const instrumentalRms of [0, SILENCE_RMS / 2, SILENCE_RMS, 0.05, 0.4]) {
        expect(judgeIncomingStems({ ...mix, instrumentalRms })).toEqual(
          judgeIncomingStems({ ...healthy, vocalsRms: 0, instrumentalRms })
        );
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

// -- clampFadeToAudio ---------------------------------------------------------

const MINIMUM = 1.5;

describe("clampFadeToAudio", () => {
  it("leaves a fade alone when the audio covers it", () => {
    expect(clampFadeToAudio(8, 200, MINIMUM)).toEqual({ kind: "fade", seconds: 8 });
  });

  it("shortens the fade to the audio available", () => {
    expect(clampFadeToAudio(12, 9, MINIMUM)).toEqual({ kind: "fade", seconds: 9 });
  });

  it("allows a fade exactly as long as the audio", () => {
    expect(clampFadeToAudio(8, 8, MINIMUM)).toEqual({ kind: "fade", seconds: 8 });
  });

  describe("edge cases", () => {
    it("refuses audio too short to fade over at all", () => {
      expect(clampFadeToAudio(8, 1.2, MINIMUM).kind).toBe("refuse");
    });

    it("allows audio exactly at the minimum", () => {
      expect(clampFadeToAudio(8, MINIMUM, MINIMUM)).toEqual({ kind: "fade", seconds: MINIMUM });
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses a fade length of %s", fade => {
      expect(clampFadeToAudio(fade, 200, MINIMUM).kind).toBe("refuse");
    });

    it.each([0, -1, Number.NaN])("refuses audio measuring %s", audio => {
      expect(clampFadeToAudio(8, audio, MINIMUM).kind).toBe("refuse");
    });
  });

  describe("invariants", () => {
    it("never returns a fade longer than the audio", () => {
      for (const fade of [1, 4, 8, 12, 20]) {
        for (const audio of [1.6, 3, 8, 15, 300]) {
          const clamped = clampFadeToAudio(fade, audio, MINIMUM);
          if (clamped.kind !== "fade") continue;
          expect(clamped.seconds).toBeLessThanOrEqual(audio);
        }
      }
    });

    it("never lengthens a fade", () => {
      for (const fade of [1.6, 4, 8, 20]) {
        for (const audio of [2, 8, 300]) {
          const clamped = clampFadeToAudio(fade, audio, MINIMUM);
          if (clamped.kind !== "fade") continue;
          expect(clamped.seconds).toBeLessThanOrEqual(fade);
        }
      }
    });

    it("always explains itself when it refuses", () => {
      const refusals = [
        clampFadeToAudio(0, 200, MINIMUM),
        clampFadeToAudio(8, 0, MINIMUM),
        clampFadeToAudio(8, 1, MINIMUM),
      ];
      for (const refusal of refusals) {
        if (refusal.kind !== "refuse") throw new Error(`expected a refusal, got ${refusal.kind}`);
        expect(refusal.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe("regressions", () => {
    it("regression: raising the crossfade mid-track shortens the fade instead of dropping the transition", () => {
      expect(clampFadeToAudio(12, 9, MINIMUM)).toEqual({ kind: "fade", seconds: 9 });
    });
  });
});
