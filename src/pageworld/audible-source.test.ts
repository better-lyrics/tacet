import { audibleSource } from "@/pageworld/audible-source";
import type { AudibleSourceInput } from "@/pageworld/audible-source";
import { describe, expect, it } from "vitest";

function graph(overrides: Partial<AudibleSourceInput> = {}): AudibleSourceInput {
  return { bypassed: false, deckPlaying: true, elementPaused: false, originalGain: 0, ...overrides };
}

describe("audibleSource", () => {
  it("answers the deck while stems are engaged and running", () => {
    expect(audibleSource(graph())).toBe("deck");
  });

  it("answers the original when there are no stems at all", () => {
    expect(audibleSource(graph({ bypassed: true, deckPlaying: false, originalGain: 1 }))).toBe("original");
  });

  it("answers nothing while the listener is paused with the original silenced", () => {
    expect(audibleSource(graph({ deckPlaying: false, elementPaused: true, originalGain: 0 }))).toBe("none");
  });

  describe("edge cases", () => {
    it("ignores a deck that is loaded but not running", () => {
      expect(audibleSource(graph({ deckPlaying: false, originalGain: 1 }))).toBe("original");
    });

    it("ignores a running deck the graph has already bypassed", () => {
      expect(audibleSource(graph({ bypassed: true, originalGain: 1 }))).toBe("original");
    });

    it("treats a partly faded original as still audible", () => {
      expect(audibleSource(graph({ deckPlaying: false, originalGain: 0.05 }))).toBe("original");
    });

    it("refuses a silenced original even while the element plays", () => {
      expect(audibleSource(graph({ deckPlaying: false, originalGain: 0 }))).toBe("none");
    });

    it("prefers the deck when both could be heard, since the deck is what the listener is on", () => {
      expect(audibleSource(graph({ originalGain: 1 }))).toBe("deck");
    });
  });

  describe("invariants", () => {
    it("never picks the deck while bypassed, since bypass means the stems are not audible", () => {
      for (const deckPlaying of [true, false]) {
        for (const originalGain of [0, 0.5, 1]) {
          expect(audibleSource(graph({ bypassed: true, deckPlaying, originalGain }))).not.toBe("deck");
        }
      }
    });

    it("never picks the original while the element is paused", () => {
      for (const originalGain of [0, 0.5, 1]) {
        for (const bypassed of [true, false]) {
          const chosen = audibleSource(graph({ bypassed, deckPlaying: false, elementPaused: true, originalGain }));
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
              sources.add(audibleSource({ bypassed, deckPlaying, elementPaused, originalGain }));
            }
          }
        }
      }
      expect([...sources].sort()).toEqual(["deck", "none", "original"]);
    });

    it("is a pure decision, since it is asked once per poll and again inside the fade", () => {
      const input = graph({ deckPlaying: false, originalGain: 1 });
      expect(audibleSource(input)).toBe(audibleSource(input));
    });
  });

  describe("regressions", () => {
    it("regression: a deck that ran out before the track did falls back to the original rather than to nothing", () => {
      expect(audibleSource(graph({ deckPlaying: false, originalGain: 1 }))).toBe("original");
    });

    it("regression: a fresh graph with crossfade on but no stems can still fade", () => {
      expect(audibleSource({ bypassed: true, deckPlaying: false, elementPaused: false, originalGain: 1 })).toBe(
        "original"
      );
    });
  });
});
