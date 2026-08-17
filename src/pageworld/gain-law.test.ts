import {
  MAX_MIX_LEVEL,
  MIN_MIX_LEVEL,
  NEUTRAL_MIX_LEVEL,
  clampMixLevel,
  faderArmed,
  gainsForMixLevel,
  listenerGain,
} from "@/pageworld/gain-law";
import { describe, expect, it } from "vitest";

describe("gainsForMixLevel", () => {
  it.each([
    [0, 0],
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
    [1, 1],
  ])("k=%s produces vocalsGain=%s and instrumentalGain=1", (k, expectedVocalsGain) => {
    const gains = gainsForMixLevel(k);
    expect(gains.vocalsGain).toBe(expectedVocalsGain);
    expect(gains.instrumentalGain).toBe(1);
  });

  it("instrumental gain never moves regardless of k", () => {
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      expect(gainsForMixLevel(k).instrumentalGain).toBe(1);
    }
  });

  describe("edge cases", () => {
    it("clamps a negative mixLevel to the minimum", () => {
      expect(gainsForMixLevel(-1).vocalsGain).toBe(MIN_MIX_LEVEL);
    });

    it("clamps a mixLevel above the maximum", () => {
      expect(gainsForMixLevel(3).vocalsGain).toBe(MAX_MIX_LEVEL);
    });

    it("never lets the vocal run louder than the original mix", () => {
      expect(MAX_MIX_LEVEL).toBe(1);
      expect(gainsForMixLevel(2).vocalsGain).toBe(1);
      expect(gainsForMixLevel(1.5).vocalsGain).toBe(1);
    });

    it("clamps a large negative value to the minimum", () => {
      expect(gainsForMixLevel(-100).vocalsGain).toBe(MIN_MIX_LEVEL);
    });

    it("clamps Infinity to the maximum", () => {
      expect(gainsForMixLevel(Number.POSITIVE_INFINITY).vocalsGain).toBe(MAX_MIX_LEVEL);
    });

    it("clamps -Infinity to the minimum", () => {
      expect(gainsForMixLevel(Number.NEGATIVE_INFINITY).vocalsGain).toBe(MIN_MIX_LEVEL);
    });

    it("passes through the exact boundary values unchanged", () => {
      expect(clampMixLevel(MIN_MIX_LEVEL)).toBe(MIN_MIX_LEVEL);
      expect(clampMixLevel(MAX_MIX_LEVEL)).toBe(MAX_MIX_LEVEL);
    });
  });

  describe("regressions", () => {
    it("rejects NaN instead of silently producing a non-finite gain", () => {
      expect(() => gainsForMixLevel(Number.NaN)).toThrow();
    });
  });

  describe("invariants", () => {
    it("is a pure function: identical input produces identical output", () => {
      expect(gainsForMixLevel(0.7)).toEqual(gainsForMixLevel(0.7));
    });

    it("never returns a gain outside [0, 1]", () => {
      for (const k of [-50, -1, 0, 0.3, 1, 1.9, 2, 50]) {
        const gains = gainsForMixLevel(k);
        expect(gains.vocalsGain).toBeGreaterThanOrEqual(MIN_MIX_LEVEL);
        expect(gains.vocalsGain).toBeLessThanOrEqual(MAX_MIX_LEVEL);
      }
    });
  });
});

describe("listenerGain", () => {
  it.each([
    [0, 0],
    [0.25, 0.25],
    [0.5, 0.5],
    [1, 1],
  ])("mirrors an unmuted volume of %s", (volume, expected) => {
    expect(listenerGain(volume, false)).toBe(expected);
  });

  it("silences the stems while the player is muted", () => {
    expect(listenerGain(1, true)).toBe(0);
    expect(listenerGain(0.6, true)).toBe(0);
  });

  describe("edge cases", () => {
    it("clamps a volume outside [0, 1]", () => {
      expect(listenerGain(-0.5, false)).toBe(0);
      expect(listenerGain(4, false)).toBe(1);
    });

    it("falls back to full volume when the element reports a non-finite one", () => {
      expect(listenerGain(Number.NaN, false)).toBe(1);
      expect(listenerGain(Number.POSITIVE_INFINITY, false)).toBe(1);
    });

    it("stays silent when muted even with a non-finite volume", () => {
      expect(listenerGain(Number.NaN, true)).toBe(0);
    });
  });

  describe("regressions", () => {
    it("does not leave the stems at full volume when the listener turns the player down", () => {
      expect(listenerGain(0.1, false)).toBeCloseTo(0.1);
      expect(listenerGain(0.1, false)).not.toBe(1);
    });
  });

  describe("invariants", () => {
    it("never returns a gain outside [0, 1]", () => {
      for (const volume of [-10, -0.1, 0, 0.33, 1, 1.5, 99, Number.NaN]) {
        for (const muted of [true, false]) {
          const gain = listenerGain(volume, muted);
          expect(gain).toBeGreaterThanOrEqual(0);
          expect(gain).toBeLessThanOrEqual(1);
        }
      }
    });

    it("is a pure function: identical input produces identical output", () => {
      expect(listenerGain(0.42, false)).toBe(listenerGain(0.42, false));
    });
  });
});

describe("faderArmed", () => {
  it("is not armed while the fader sits at the neutral level", () => {
    expect(faderArmed(NEUTRAL_MIX_LEVEL)).toBe(false);
  });

  it.each([0, 0.25, 0.5, 0.75])("is armed once the listener pulls the fader down to %s", mixLevel => {
    expect(faderArmed(mixLevel)).toBe(true);
  });

  describe("edge cases", () => {
    it("counts a level above neutral as armed, since only neutral means the listener asked for nothing", () => {
      expect(faderArmed(MAX_MIX_LEVEL + 0.5)).toBe(true);
    });

    it("counts the minimum as armed", () => {
      expect(faderArmed(MIN_MIX_LEVEL)).toBe(true);
    });
  });
});
