import { DECODE_LEAD_SECONDS, decideTransitionCue } from "@/automix/transition-cue";
import type { StagedState, TransitionCue, TransitionCueInput } from "@/automix/transition-cue";
import { describe, expect, it } from "vitest";

const POLL = 1;

const playing: TransitionCueInput = {
  remainingSeconds: 120,
  fadeSeconds: 8,
  decodeLeadSeconds: DECODE_LEAD_SECONDS,
  pollIntervalSeconds: POLL,
  staged: "encoded",
  crossfading: false,
};

function expectFade(cue: TransitionCue): { kind: "fade"; startInSeconds: number; durationSeconds: number } {
  if (cue.kind !== "fade") throw new Error(`expected a fade, got ${cue.kind}`);
  return cue;
}

// fade + poll: the cue is asked one poll early so it can delay the start.
const FADE_AT = playing.fadeSeconds + POLL;
const DECODE_AT = FADE_AT + DECODE_LEAD_SECONDS;

describe("decideTransitionCue", () => {
  it("waits while the track is still far from its end", () => {
    expect(decideTransitionCue(playing)).toEqual({ kind: "wait" });
  });

  it("decodes once the remaining time falls inside the fade plus the decode lead", () => {
    expect(decideTransitionCue({ ...playing, remainingSeconds: DECODE_AT - 0.5 })).toEqual({ kind: "decode" });
  });

  it("leaves at least eight times the worst measured decode of 633 ms", () => {
    expect(DECODE_LEAD_SECONDS).toBeGreaterThanOrEqual(0.633 * 8);
  });

  it("fades once the remaining time reaches the fade length and the decode has landed", () => {
    const cue = expectFade(decideTransitionCue({ ...playing, remainingSeconds: 8, staged: "ready" }));
    expect(cue.startInSeconds).toBe(0);
  });

  it("delays the start so the fade ends exactly when the outgoing track does", () => {
    for (const remaining of [8, 8.25, 8.5, 8.75, 9]) {
      const cue = expectFade(decideTransitionCue({ ...playing, remainingSeconds: remaining, staged: "ready" }));
      expect(cue.startInSeconds + cue.durationSeconds).toBeCloseTo(remaining, 10);
      expect(cue.durationSeconds).toBe(playing.fadeSeconds);
    }
  });

  it("shortens the fade rather than running past the end when the cue arrives late", () => {
    for (const remaining of [0.1, 1, 4, 7.9]) {
      const cue = expectFade(decideTransitionCue({ ...playing, remainingSeconds: remaining, staged: "ready" }));
      expect(cue.startInSeconds).toBe(0);
      expect(cue.durationSeconds).toBeCloseTo(remaining, 10);
    }
  });

  it("skips when the decode did not finish in time", () => {
    const cue = decideTransitionCue({ ...playing, remainingSeconds: 7.5, staged: "decoding" });
    expect(cue.kind).toBe("skip");
    expect(cue).toMatchObject({ reason: expect.stringContaining("decoding") });
  });

  describe("edge cases", () => {
    it("waits when nothing has been staged, however little is left", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: 0.5, staged: "none" })).toEqual({ kind: "wait" });
    });

    it("waits while a crossfade is already in flight", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: 4, staged: "ready", crossfading: true })).toEqual({
        kind: "wait",
      });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -3])("waits on a remaining time of %s", remaining => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: remaining, staged: "ready" })).toEqual({
        kind: "wait",
      });
    });

    it.each([0, -1, Number.NaN])("skips on a fade length of %s", fade => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: 4, fadeSeconds: fade, staged: "ready" }).kind).toBe(
        "skip"
      );
    });

    it("asks for the decode exactly once, since a decode in flight reads as waiting", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: DECODE_AT - 0.5, staged: "decoding" })).toEqual({
        kind: "wait",
      });
      expect(decideTransitionCue({ ...playing, remainingSeconds: DECODE_AT - 0.5, staged: "ready" })).toEqual({
        kind: "wait",
      });
    });

    it("decodes right at the boundary and waits a moment before it", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: DECODE_AT })).toEqual({ kind: "decode" });
      expect(decideTransitionCue({ ...playing, remainingSeconds: DECODE_AT + 0.01 })).toEqual({ kind: "wait" });
    });

    it("fades right at the boundary and decodes a moment before it", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: FADE_AT, staged: "ready" }).kind).toBe("fade");
      expect(decideTransitionCue({ ...playing, remainingSeconds: FADE_AT + 0.01, staged: "encoded" })).toEqual({
        kind: "decode",
      });
    });

    it("never asks for a negative delay when the cue arrives late", () => {
      for (const remaining of [0.1, 1, 4, 7.9]) {
        const cue = expectFade(decideTransitionCue({ ...playing, remainingSeconds: remaining, staged: "ready" }));
        expect(cue.startInSeconds).toBe(0);
      }
    });

    it("never asks for a fade longer than the fade setting", () => {
      for (const remaining of [0.1, 4, 8, 8.9, 9]) {
        const cue = expectFade(decideTransitionCue({ ...playing, remainingSeconds: remaining, staged: "ready" }));
        expect(cue.durationSeconds).toBeLessThanOrEqual(playing.fadeSeconds);
        expect(cue.durationSeconds).toBeGreaterThan(0);
      }
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      "treats a poll interval of %s as no lead at all",
      interval => {
        const input = { ...playing, pollIntervalSeconds: interval, staged: "ready" as const };
        expect(decideTransitionCue({ ...input, remainingSeconds: 8.5 })).toEqual({ kind: "wait" });
        expect(decideTransitionCue({ ...input, remainingSeconds: 8 }).kind).toBe("fade");
      }
    );

    it("scales the lead with the poll interval, so a slower loop still lands the fade", () => {
      const slow = { ...playing, pollIntervalSeconds: 4, staged: "ready" as const };
      const cue = expectFade(decideTransitionCue({ ...slow, remainingSeconds: 11.5 }));
      expect(cue.startInSeconds).toBeCloseTo(3.5, 10);
      expect(cue.durationSeconds).toBe(8);
    });
  });

  describe("invariants", () => {
    const states: StagedState[] = ["none", "encoded", "decoding", "ready"];
    const remainings = [0.5, 4, 8, 9, 22, 24, 120];

    it("never fades unless the stems are decoded and ready", () => {
      for (const staged of states) {
        for (const remaining of remainings) {
          const cue = decideTransitionCue({ ...playing, remainingSeconds: remaining, staged });
          if (cue.kind === "fade") expect(staged).toBe("ready");
        }
      }
    });

    it("never asks for a decode unless the stems are still encoded", () => {
      for (const staged of states) {
        for (const remaining of remainings) {
          const cue = decideTransitionCue({ ...playing, remainingSeconds: remaining, staged });
          if (cue.kind === "decode") expect(staged).toBe("encoded");
        }
      }
    });

    it("the fade always ends exactly when the outgoing track does", () => {
      for (const fadeSeconds of [4, 8, 12]) {
        for (const remaining of [0.5, 4, 7.9, 8, 8.4, 9, 12, 13, 22]) {
          const cue = decideTransitionCue({ ...playing, fadeSeconds, remainingSeconds: remaining, staged: "ready" });
          if (cue.kind !== "fade") continue;
          expect(cue.startInSeconds + cue.durationSeconds).toBeCloseTo(remaining, 10);
        }
      }
    });

    it("always explains itself when it skips", () => {
      const skips: TransitionCueInput[] = [
        { ...playing, remainingSeconds: 4, staged: "encoded" },
        { ...playing, remainingSeconds: 4, staged: "decoding" },
        { ...playing, remainingSeconds: 4, fadeSeconds: 0, staged: "ready" },
      ];
      for (const input of skips) {
        const cue = decideTransitionCue(input);
        if (cue.kind !== "skip") throw new Error(`expected a skip, got ${cue.kind}`);
        expect(cue.reason.length).toBeGreaterThan(0);
      }
    });

    it("is idempotent, since it is polled rather than edge triggered", () => {
      for (const staged of states) {
        for (const remaining of remainings) {
          const input = { ...playing, remainingSeconds: remaining, staged };
          expect(decideTransitionCue(input)).toEqual(decideTransitionCue(input));
        }
      }
    });

    it("every fade length the popup offers reaches a fade, given a long enough track", () => {
      for (const fadeSeconds of [4, 6, 8, 12]) {
        const cue = decideTransitionCue({ ...playing, fadeSeconds, remainingSeconds: fadeSeconds, staged: "ready" });
        expect(cue.kind).toBe("fade");
      }
    });
  });

  describe("regressions", () => {
    it("regression: a fade never starts against a track that has already run out", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: 0, staged: "ready" })).toEqual({ kind: "wait" });
    });

    it("regression: a stale deck reading of NaN does not read as the end of the track", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: Number.NaN, staged: "ready" })).toEqual({
        kind: "wait",
      });
    });

    it("regression: waiting while crossfading stops a second fade being scheduled from the same cue", () => {
      const midFade = { ...playing, remainingSeconds: 2, staged: "ready" as const, crossfading: true };
      expect(decideTransitionCue(midFade)).toEqual({ kind: "wait" });
    });

    it("regression: the fade is delayed rather than started at once, which measured as a dip to 56 %", () => {
      const cue = expectFade(decideTransitionCue({ ...playing, remainingSeconds: 8.9, staged: "ready" }));
      expect(cue.startInSeconds).toBeGreaterThan(0);
    });

    it("regression: the decode window still opens before the fade window, whatever the lead", () => {
      for (const pollIntervalSeconds of [0.25, 1, 4]) {
        const input = { ...playing, pollIntervalSeconds };
        const fadeAt = playing.fadeSeconds + pollIntervalSeconds;
        expect(decideTransitionCue({ ...input, remainingSeconds: fadeAt + 0.01 })).toEqual({ kind: "decode" });
      }
    });
  });
});
