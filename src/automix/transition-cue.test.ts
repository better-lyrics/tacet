import { DECODE_LEAD_SECONDS, decideTransitionCue } from "@/automix/transition-cue";
import type { StagedState, TransitionCueInput } from "@/automix/transition-cue";
import { describe, expect, it } from "vitest";

const playing: TransitionCueInput = {
  remainingSeconds: 120,
  fadeSeconds: 8,
  decodeLeadSeconds: DECODE_LEAD_SECONDS,
  staged: "encoded",
  crossfading: false,
};

describe("decideTransitionCue", () => {
  it("waits while the track is still far from its end", () => {
    expect(decideTransitionCue(playing)).toEqual({ kind: "wait" });
  });

  it("decodes once the remaining time falls inside the fade plus the decode lead", () => {
    expect(decideTransitionCue({ ...playing, remainingSeconds: 22 })).toEqual({ kind: "decode" });
  });

  it("fades once the remaining time reaches the fade length and the decode has landed", () => {
    expect(decideTransitionCue({ ...playing, remainingSeconds: 7.5, staged: "ready" })).toEqual({ kind: "fade" });
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
      expect(decideTransitionCue({ ...playing, remainingSeconds: 22, staged: "decoding" })).toEqual({ kind: "wait" });
      expect(decideTransitionCue({ ...playing, remainingSeconds: 22, staged: "ready" })).toEqual({ kind: "wait" });
    });

    it("decodes right at the boundary and waits a moment before it", () => {
      const boundary = playing.fadeSeconds + DECODE_LEAD_SECONDS;
      expect(decideTransitionCue({ ...playing, remainingSeconds: boundary })).toEqual({ kind: "decode" });
      expect(decideTransitionCue({ ...playing, remainingSeconds: boundary + 0.01 })).toEqual({ kind: "wait" });
    });

    it("fades right at the boundary and decodes a moment before it", () => {
      expect(decideTransitionCue({ ...playing, remainingSeconds: 8, staged: "ready" })).toEqual({ kind: "fade" });
      expect(decideTransitionCue({ ...playing, remainingSeconds: 8.01, staged: "encoded" })).toEqual({
        kind: "decode",
      });
    });

    it("never finds room to decode when the lead is zero, and skips rather than stalling", () => {
      const noLead = { ...playing, decodeLeadSeconds: 0 };
      expect(decideTransitionCue({ ...noLead, remainingSeconds: 8.01 })).toEqual({ kind: "wait" });
      expect(decideTransitionCue({ ...noLead, remainingSeconds: 8 }).kind).toBe("skip");
    });
  });

  describe("invariants", () => {
    const states: StagedState[] = ["none", "encoded", "decoding", "ready"];

    it("never fades unless the stems are decoded and ready", () => {
      for (const staged of states) {
        for (const remaining of [0.5, 4, 8, 22, 120]) {
          const cue = decideTransitionCue({ ...playing, remainingSeconds: remaining, staged });
          if (cue.kind === "fade") expect(staged).toBe("ready");
        }
      }
    });

    it("never asks for a decode unless the stems are still encoded", () => {
      for (const staged of states) {
        for (const remaining of [0.5, 4, 8, 22, 120]) {
          const cue = decideTransitionCue({ ...playing, remainingSeconds: remaining, staged });
          if (cue.kind === "decode") expect(staged).toBe("encoded");
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
        for (const remaining of [0.5, 4, 8, 22, 120]) {
          const input = { ...playing, remainingSeconds: remaining, staged };
          expect(decideTransitionCue(input)).toEqual(decideTransitionCue(input));
        }
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
  });
});
