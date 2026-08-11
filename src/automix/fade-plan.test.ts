import { describe, expect, it } from "vitest";
import { advanceDelaySeconds, chooseOutgoingSource, decideAdvance } from "@/automix/fade-plan";
import type { OutgoingSourceInput } from "@/automix/fade-plan";

function graph(overrides: Partial<OutgoingSourceInput> = {}): OutgoingSourceInput {
  return { bypassed: false, deckPlaying: true, elementPaused: false, originalGain: 0, ...overrides };
}

describe("chooseOutgoingSource", () => {
  it("fades out of the deck while stems are engaged and running", () => {
    expect(chooseOutgoingSource(graph())).toBe("deck");
  });

  it("fades out of the element when there are no stems at all", () => {
    expect(chooseOutgoingSource(graph({ bypassed: true, deckPlaying: false, originalGain: 1 }))).toBe("original");
  });

  it("finds nothing to fade out of while the listener is paused with the original silenced", () => {
    expect(chooseOutgoingSource(graph({ deckPlaying: false, elementPaused: true, originalGain: 0 }))).toBe("none");
  });

  describe("edge cases", () => {
    it("ignores a deck that is loaded but not running", () => {
      expect(chooseOutgoingSource(graph({ deckPlaying: false, originalGain: 1 }))).toBe("original");
    });

    it("ignores a running deck the graph has already bypassed", () => {
      expect(chooseOutgoingSource(graph({ bypassed: true, originalGain: 1 }))).toBe("original");
    });

    it("treats a partly faded original as still audible", () => {
      expect(chooseOutgoingSource(graph({ deckPlaying: false, originalGain: 0.05 }))).toBe("original");
    });

    it("refuses a silenced original even while the element plays", () => {
      expect(chooseOutgoingSource(graph({ deckPlaying: false, originalGain: 0 }))).toBe("none");
    });

    it("prefers the deck when both could be heard, since the deck is what the listener is on", () => {
      expect(chooseOutgoingSource(graph({ originalGain: 1 }))).toBe("deck");
    });
  });

  describe("invariants", () => {
    it("never picks the deck while bypassed, since bypass means the stems are not audible", () => {
      for (const deckPlaying of [true, false]) {
        for (const originalGain of [0, 0.5, 1]) {
          expect(chooseOutgoingSource(graph({ bypassed: true, deckPlaying, originalGain }))).not.toBe("deck");
        }
      }
    });

    it("never picks the original while the element is paused", () => {
      for (const originalGain of [0, 0.5, 1]) {
        for (const bypassed of [true, false]) {
          const chosen = chooseOutgoingSource(
            graph({ bypassed, deckPlaying: false, elementPaused: true, originalGain })
          );
          expect(chosen).not.toBe("original");
        }
      }
    });

    it("answers with exactly one of the three sources for every combination", () => {
      const sources = new Set();
      for (const bypassed of [true, false]) {
        for (const deckPlaying of [true, false]) {
          for (const elementPaused of [true, false]) {
            for (const originalGain of [0, 1]) {
              sources.add(chooseOutgoingSource({ bypassed, deckPlaying, elementPaused, originalGain }));
            }
          }
        }
      }
      expect([...sources].sort()).toEqual(["deck", "none", "original"]);
    });

    it("is a pure decision, since it is asked once per poll and again inside the fade", () => {
      const input = graph({ deckPlaying: false, originalGain: 1 });
      expect(chooseOutgoingSource(input)).toBe(chooseOutgoingSource(input));
    });
  });

  describe("regressions", () => {
    it("regression: a deck that ran out before the track did falls back to the original rather than to nothing", () => {
      expect(chooseOutgoingSource(graph({ deckPlaying: false, originalGain: 1 }))).toBe("original");
    });

    it("regression: a fresh graph with crossfade on but no stems can still fade", () => {
      expect(chooseOutgoingSource({ bypassed: true, deckPlaying: false, elementPaused: false, originalGain: 1 })).toBe(
        "original"
      );
    });
  });
});

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
  const at = (overrides = {}) => ({
    playerVideoId: "from",
    intoVideoId: "into",
    elementMovedOn: false,
    ...overrides,
  });

  it("advances the player when it is still on the track being faded out of", () => {
    expect(decideAdvance(at())).toBe("advance");
  });

  it("leaves a player that already reached the track alone", () => {
    expect(decideAdvance(at({ playerVideoId: "into" }))).toBe("already-there");
  });

  describe("edge cases", () => {
    it("advances a player that names nothing yet and has not moved on", () => {
      expect(decideAdvance(at({ playerVideoId: null }))).toBe("advance");
    });

    it("prefers what the player names over what the element did", () => {
      expect(decideAdvance(at({ playerVideoId: "into", elementMovedOn: true }))).toBe("already-there");
    });
  });

  describe("invariants", () => {
    it("never advances once the element has moved on by itself", () => {
      for (const playerVideoId of ["from", null, "elsewhere"]) {
        expect(decideAdvance(at({ playerVideoId, elementMovedOn: true }))).not.toBe("advance");
      }
    });
  });

  describe("regressions", () => {
    it("regression: does not skip the track it just faded into when the queue advanced first", () => {
      // getVideoData().video_id keeps naming the previous track for seconds
      // after a natural advance, so the id alone said "advance" and nextVideo()
      // then jumped past the incoming track entirely.
      expect(decideAdvance(at({ playerVideoId: "from", elementMovedOn: true }))).toBe("moved-on");
    });
  });
});
