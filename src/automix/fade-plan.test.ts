import { describe, expect, it } from "vitest";
import { PLAYER_REWIND_TOLERANCE_SECONDS, advanceDelaySeconds, decideAdvance } from "@/automix/fade-plan";
import type { AdvanceInput } from "@/automix/fade-plan";

describe("advanceDelaySeconds", () => {
  const LEAD = 0.15;

  it("advances at the midpoint of a fade out of the deck", () => {
    expect(advanceDelaySeconds("deck", 8, LEAD)).toBe(4);
  });

  it("advances just before the end of a fade out of the original", () => {
    expect(advanceDelaySeconds("original", 8, LEAD)).toBeCloseTo(7.85, 6);
  });

  describe("edge cases", () => {
    it("never returns a negative delay for a fade shorter than the lead", () => {
      expect(advanceDelaySeconds("original", 0.1, LEAD)).toBe(0);
    });

    it("falls back to the end of the fade when the lead is unusable", () => {
      expect(advanceDelaySeconds("original", 8, Number.NaN)).toBe(8);
      expect(advanceDelaySeconds("original", 8, -1)).toBe(8);
    });

    it("returns zero for a fade with no usable length", () => {
      for (const fade of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(advanceDelaySeconds("deck", fade, LEAD)).toBe(0);
        expect(advanceDelaySeconds("original", fade, LEAD)).toBe(0);
      }
    });
  });

  describe("invariants", () => {
    it("never advances after the fade has finished", () => {
      for (const fade of [1.5, 4, 8, 12, 20]) {
        expect(advanceDelaySeconds("deck", fade, LEAD)).toBeLessThanOrEqual(fade);
        expect(advanceDelaySeconds("original", fade, LEAD)).toBeLessThanOrEqual(fade);
      }
    });

    it("always advances later out of the original than out of the deck, for any fade worth running", () => {
      for (const fade of [1.5, 4, 8, 12, 20]) {
        expect(advanceDelaySeconds("original", fade, LEAD)).toBeGreaterThan(advanceDelaySeconds("deck", fade, LEAD));
      }
    });

    it("is monotonic in the fade length", () => {
      const sources: ("deck" | "original")[] = ["deck", "original"];
      for (const outgoing of sources) {
        let previous = -1;
        for (const fade of [1.5, 4, 8, 12, 20]) {
          const delay = advanceDelaySeconds(outgoing, fade, LEAD);
          expect(delay).toBeGreaterThanOrEqual(previous);
          previous = delay;
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: a fade out of the original never advances at the midpoint, which would play the incoming track twice", () => {
      for (const fade of [4, 8, 12]) {
        expect(advanceDelaySeconds("original", fade, LEAD)).not.toBeCloseTo(fade / 2, 6);
      }
    });

    it("regression: the element is still audible at the deck midpoint, so only the deck case advances there", () => {
      expect(advanceDelaySeconds("deck", 12, LEAD)).toBe(6);
      expect(advanceDelaySeconds("original", 12, LEAD)).toBeCloseTo(11.85, 6);
    });
  });
});

describe("decideAdvance", () => {
  const at = (overrides: Partial<AdvanceInput> = {}): AdvanceInput => ({
    listenerVideoId: "from",
    intoVideoId: "into",
    elementMovedOn: false,
    playerPositionSeconds: 210,
    positionWhenScheduledSeconds: 206,
    ...overrides,
  });

  it("advances the player when it is still on the track being faded out of", () => {
    expect(decideAdvance(at())).toBe("advance");
  });

  it("leaves a player that already reached the track alone", () => {
    expect(decideAdvance(at({ listenerVideoId: "into" }))).toBe("already-there");
  });

  describe("edge cases", () => {
    it("advances a player that names nothing yet and has not moved on", () => {
      expect(decideAdvance(at({ listenerVideoId: null }))).toBe("advance");
    });

    it("prefers what the listener is on over what the element did", () => {
      expect(decideAdvance(at({ listenerVideoId: "into", elementMovedOn: true }))).toBe("already-there");
    });

    it("ignores an unreadable clock rather than reading it as a rewind", () => {
      expect(decideAdvance(at({ playerPositionSeconds: Number.NaN }))).toBe("advance");
      expect(decideAdvance(at({ positionWhenScheduledSeconds: Number.NaN }))).toBe("advance");
    });

    it("allows the clock to jitter without calling it a track change", () => {
      const edge = PLAYER_REWIND_TOLERANCE_SECONDS;
      expect(decideAdvance(at({ playerPositionSeconds: 206 - edge }))).toBe("advance");
      expect(decideAdvance(at({ playerPositionSeconds: 206 - edge - 0.01 }))).toBe("moved-on");
    });
  });

  describe("invariants", () => {
    it("never advances once the element has moved on by itself", () => {
      for (const listenerVideoId of ["from", null, "elsewhere"]) {
        expect(decideAdvance(at({ listenerVideoId, elementMovedOn: true }))).not.toBe("advance");
      }
    });

    it("never advances once the player's own clock has restarted", () => {
      for (const listenerVideoId of ["from", null, "elsewhere"]) {
        expect(decideAdvance(at({ listenerVideoId, playerPositionSeconds: 0.4 }))).not.toBe("advance");
      }
    });
  });

  describe("regressions", () => {
    it("regression: does not skip the track it just faded into when the queue advanced first", () => {
      // getVideoData().video_id keeps naming the previous track for seconds
      // after a natural advance, so the id alone said "advance" and nextVideo()
      // then jumped past the incoming track entirely.
      expect(decideAdvance(at({ listenerVideoId: "from", elementMovedOn: true }))).toBe("moved-on");
    });

    it("regression: catches a gapless advance, which emits no emptied at all", () => {
      // The element is reused and never emptied, so the only evidence is the
      // player's own clock restarting while the id still lags.
      expect(decideAdvance(at({ listenerVideoId: "from", elementMovedOn: false, playerPositionSeconds: 0.2 }))).toBe(
        "moved-on"
      );
    });
  });
});
