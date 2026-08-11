import { describe, expect, it } from "vitest";
import { decideStagedSource, isStagingSpent } from "@/automix/staged-source";
import type { StagedKind, StagedSourceInput } from "@/automix/staged-source";
import type { StagedState } from "@/automix/transition-cue";

const FADE_SECONDS = 8;
const DECODE_LEAD_SECONDS = 6;
const DEADLINE = FADE_SECONDS + DECODE_LEAD_SECONDS;

const STATES: StagedState[] = ["none", "encoded", "decoding", "ready"];
const KINDS: StagedKind[] = ["stems", "mix"];
const CLOCKS = [0, 1, 9, DEADLINE, DEADLINE + 0.01, 30, 120, Number.NaN, Number.POSITIVE_INFINITY, -4];

const stemsOverMix: StagedSourceInput = {
  held: { videoId: "trackB", kind: "mix", state: "ready" },
  offered: { videoId: "trackB", kind: "stems" },
  remainingSeconds: 120,
  fadeSeconds: FADE_SECONDS,
  decodeLeadSeconds: DECODE_LEAD_SECONDS,
};

function reasonFor(input: StagedSourceInput): string {
  const choice = decideStagedSource(input);
  if (choice.kind !== "keep") throw new Error(`expected a keep, got ${choice.kind}`);
  return choice.reason;
}

describe("decideStagedSource", () => {
  it("takes whatever is offered when nothing is staged", () => {
    expect(decideStagedSource({ ...stemsOverMix, held: null })).toEqual({ kind: "take" });
    expect(decideStagedSource({ ...stemsOverMix, held: null, offered: { videoId: "trackB", kind: "mix" } })).toEqual({
      kind: "take",
    });
  });

  it("takes the stems that arrive after the mix, while there is still time to decode them", () => {
    expect(decideStagedSource(stemsOverMix)).toEqual({ kind: "take" });
  });

  it("keeps the mix once the stems arrive too late to decode", () => {
    expect(decideStagedSource({ ...stemsOverMix, remainingSeconds: 9 }).kind).toBe("keep");
  });

  it("keeps the stems when a mix for the same track turns up after them", () => {
    const late: StagedSourceInput = {
      ...stemsOverMix,
      held: { videoId: "trackB", kind: "stems", state: "ready" },
      offered: { videoId: "trackB", kind: "mix" },
    };
    expect(late.offered.kind).toBe("mix");
    expect(decideStagedSource(late).kind).toBe("keep");
  });

  it("keeps what is staged when the same source is offered twice", () => {
    const again: StagedSourceInput = { ...stemsOverMix, offered: { videoId: "trackB", kind: "mix" } };
    expect(decideStagedSource(again).kind).toBe("keep");
  });

  it("takes anything offered for a track other than the one staged", () => {
    const moved: StagedSourceInput = { ...stemsOverMix, offered: { videoId: "trackC", kind: "mix" } };
    expect(decideStagedSource(moved)).toEqual({ kind: "take" });
  });

  describe("edge cases", () => {
    it("takes the stems a moment before the decode deadline and keeps the mix on it", () => {
      expect(decideStagedSource({ ...stemsOverMix, remainingSeconds: DEADLINE + 0.01 })).toEqual({ kind: "take" });
      expect(decideStagedSource({ ...stemsOverMix, remainingSeconds: DEADLINE }).kind).toBe("keep");
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3])(
      "keeps the staged mix on a remaining time of %s",
      remainingSeconds => {
        expect(decideStagedSource({ ...stemsOverMix, remainingSeconds }).kind).toBe("keep");
      }
    );

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      "keeps the staged mix on a fade length of %s",
      fadeSeconds => {
        expect(decideStagedSource({ ...stemsOverMix, fadeSeconds }).kind).toBe("keep");
      }
    );

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
      "keeps the staged mix on a decode lead of %s",
      decodeLeadSeconds => {
        expect(decideStagedSource({ ...stemsOverMix, decodeLeadSeconds }).kind).toBe("keep");
      }
    );

    it("takes a decode lead of zero at face value, since the deadline is then the fade alone", () => {
      const noLead = { ...stemsOverMix, decodeLeadSeconds: 0 };
      expect(decideStagedSource({ ...noLead, remainingSeconds: FADE_SECONDS + 0.01 })).toEqual({ kind: "take" });
      expect(decideStagedSource({ ...noLead, remainingSeconds: FADE_SECONDS }).kind).toBe("keep");
    });

    it("refills a slot that names a source it no longer holds", () => {
      const emptied: StagedSourceInput = {
        ...stemsOverMix,
        held: { videoId: "trackB", kind: "mix", state: "none" },
        offered: { videoId: "trackB", kind: "mix" },
      };
      expect(decideStagedSource(emptied)).toEqual({ kind: "take" });
    });

    it("takes the stems over an emptied mix slot even with no time left to decode", () => {
      const emptied: StagedSourceInput = {
        ...stemsOverMix,
        held: { videoId: "trackB", kind: "mix", state: "none" },
        remainingSeconds: 0.5,
      };
      expect(decideStagedSource(emptied)).toEqual({ kind: "take" });
    });

    it("takes the stems whatever the mix has already spent on decoding", () => {
      for (const state of STATES) {
        const held = { videoId: "trackB", kind: "mix" as const, state };
        expect(decideStagedSource({ ...stemsOverMix, held })).toEqual({ kind: "take" });
      }
    });

    it("treats an empty videoId as just another track, not as nothing staged", () => {
      const unnamed: StagedSourceInput = {
        ...stemsOverMix,
        held: { videoId: "", kind: "stems", state: "ready" },
        offered: { videoId: "", kind: "mix" },
      };
      expect(decideStagedSource(unnamed).kind).toBe("keep");
    });
  });

  describe("invariants", () => {
    it("never downgrades stems to a mix for the same track", () => {
      for (const state of STATES) {
        for (const remainingSeconds of CLOCKS) {
          for (const fadeSeconds of [0, 4, 8, 12, Number.NaN]) {
            for (const decodeLeadSeconds of [0, 6, Number.NaN]) {
              const input: StagedSourceInput = {
                held: { videoId: "trackB", kind: "stems", state },
                offered: { videoId: "trackB", kind: "mix" },
                remainingSeconds,
                fadeSeconds,
                decodeLeadSeconds,
              };
              expect(decideStagedSource(input).kind).toBe("keep");
            }
          }
        }
      }
    });

    it("a different videoId always replaces whatever is held", () => {
      for (const heldKind of KINDS) {
        for (const offeredKind of KINDS) {
          for (const state of STATES) {
            for (const remainingSeconds of CLOCKS) {
              const input: StagedSourceInput = {
                held: { videoId: "trackB", kind: heldKind, state },
                offered: { videoId: "trackC", kind: offeredKind },
                remainingSeconds,
                fadeSeconds: FADE_SECONDS,
                decodeLeadSeconds: DECODE_LEAD_SECONDS,
              };
              expect(decideStagedSource(input)).toEqual({ kind: "take" });
            }
          }
        }
      }
    });

    it("only ever swaps a mix that holds audio for stems, on the same track", () => {
      for (const heldKind of KINDS) {
        for (const offeredKind of KINDS) {
          for (const remainingSeconds of CLOCKS) {
            const input: StagedSourceInput = {
              held: { videoId: "trackB", kind: heldKind, state: "ready" },
              offered: { videoId: "trackB", kind: offeredKind },
              remainingSeconds,
              fadeSeconds: FADE_SECONDS,
              decodeLeadSeconds: DECODE_LEAD_SECONDS,
            };
            if (decideStagedSource(input).kind !== "take") continue;
            expect(heldKind).toBe("mix");
            expect(offeredKind).toBe("stems");
          }
        }
      }
    });

    it("always explains itself when it keeps", () => {
      const keeps: StagedSourceInput[] = [
        { ...stemsOverMix, offered: { videoId: "trackB", kind: "mix" } },
        { ...stemsOverMix, held: { videoId: "trackB", kind: "stems", state: "ready" } },
        { ...stemsOverMix, remainingSeconds: 9 },
        { ...stemsOverMix, remainingSeconds: Number.NaN },
        { ...stemsOverMix, fadeSeconds: 0 },
      ];
      for (const input of keeps) {
        expect(reasonFor(input).length).toBeGreaterThan(0);
      }
    });

    it("is a pure decision, since it is asked once per delivery and once per retry", () => {
      for (const state of STATES) {
        for (const remainingSeconds of CLOCKS) {
          const held = { videoId: "trackB", kind: "mix" as const, state };
          const input: StagedSourceInput = { ...stemsOverMix, held, remainingSeconds };
          expect(decideStagedSource(input)).toEqual(decideStagedSource(input));
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: stems arriving with no time to decode do not cost the transition its fade", () => {
      for (const remainingSeconds of [0.5, 4, 8, 12, DEADLINE]) {
        expect(decideStagedSource({ ...stemsOverMix, remainingSeconds }).kind).toBe("keep");
      }
    });

    it("regression: an unreadable clock never trades a staged mix for stems it cannot decode", () => {
      expect(decideStagedSource({ ...stemsOverMix, remainingSeconds: Number.NaN }).kind).toBe("keep");
      expect(decideStagedSource({ ...stemsOverMix, remainingSeconds: Number.POSITIVE_INFINITY }).kind).toBe("keep");
    });

    it("regression: the queue moving on outranks the never-downgrade rule", () => {
      const moved: StagedSourceInput = {
        ...stemsOverMix,
        held: { videoId: "trackB", kind: "stems", state: "ready" },
        offered: { videoId: "trackC", kind: "mix" },
      };
      expect(decideStagedSource(moved)).toEqual({ kind: "take" });
    });

    it("regression: a mix delivered twice does not restage over stems taken in between", () => {
      const first: StagedSourceInput = { ...stemsOverMix, held: { videoId: "trackB", kind: "mix", state: "encoded" } };
      expect(decideStagedSource(first)).toEqual({ kind: "take" });

      const second: StagedSourceInput = {
        ...stemsOverMix,
        held: { videoId: "trackB", kind: "stems", state: "encoded" },
        offered: { videoId: "trackB", kind: "mix" },
      };
      expect(decideStagedSource(second).kind).toBe("keep");
    });
  });
});

describe("isStagingSpent", () => {
  it("holds staging that still points at the next track", () => {
    expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: "b", listenerVideoId: "a" })).toBe(false);
  });

  it("drops staging once the listener is on the track it staged", () => {
    expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: "c", listenerVideoId: "b" })).toBe(true);
  });

  it("drops staging the queue has moved past", () => {
    expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: "c", listenerVideoId: "a" })).toBe(true);
  });

  describe("edge cases", () => {
    it("has nothing to drop when nothing is staged", () => {
      expect(isStagingSpent({ stagedVideoId: null, nextTrackVideoId: "c", listenerVideoId: "a" })).toBe(false);
    });

    it("keeps staging while the next track is unknown, since a fade may still want it", () => {
      expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: null, listenerVideoId: "a" })).toBe(false);
    });

    it("keeps staging while the listener's track is unreadable and the queue still agrees", () => {
      expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: "b", listenerVideoId: null })).toBe(false);
    });

    it("drops staging the queue moved past even when the listener is unreadable", () => {
      expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: "c", listenerVideoId: null })).toBe(true);
    });
  });

  describe("invariants", () => {
    it("never drops staging that matches both the next track and a different listener track", () => {
      for (const listener of ["a", "x", null]) {
        expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: "b", listenerVideoId: listener })).toBe(false);
      }
    });

    it("is a pure decision, since reconcile asks it every tick", () => {
      const input = { stagedVideoId: "b", nextTrackVideoId: "c", listenerVideoId: "a" };
      expect(isStagingSpent(input)).toBe(isStagingSpent(input));
    });
  });

  describe("regressions", () => {
    it("regression: a natural advance with separation off releases the staged mix rather than retaining it", () => {
      expect(isStagingSpent({ stagedVideoId: "b", nextTrackVideoId: null, listenerVideoId: "b" })).toBe(true);
    });
  });
});
