import { describe, expect, it } from "vitest";
import { decideCrossfadeLanding } from "@/orchestrator/crossfade-landing";
import type { CrossfadeLandingInput, LandingKind } from "@/orchestrator/crossfade-landing";
import type { KaraokeStatus } from "@/orchestrator/karaoke-state";

const KINDS: LandingKind[] = ["stems", "mix"];
const STATUSES: KaraokeStatus[] = ["waiting-for-capture", "ready-to-engage", "processing", "engaged", "failed"];
const UNENGAGED: KaraokeStatus[] = STATUSES.filter(status => status !== "engaged");
const SEPARATING: boolean[] = [true, false];

function landing(kind: LandingKind, status: KaraokeStatus, separating = true): CrossfadeLandingInput {
  return { kind, status, separating };
}

describe("decideCrossfadeLanding", () => {
  it("is finished when the fade landed on separated stems", () => {
    expect(decideCrossfadeLanding(landing("stems", "engaged"))).toBe("keep-deck");
  });

  it("keeps the unseparated audio playing but sends the track off to be separated", () => {
    expect(decideCrossfadeLanding(landing("mix", "engaged"))).toBe("keep-deck-and-reacquire");
  });

  it("releases the deck when the pipeline was the thing driving it and no longer is", () => {
    expect(decideCrossfadeLanding(landing("stems", "waiting-for-capture"))).toBe("release");
  });

  it("keeps a mix landing whatever the pipeline is doing, since the page world staged it", () => {
    expect(decideCrossfadeLanding(landing("mix", "waiting-for-capture"))).toBe("keep-deck-and-reacquire");
  });

  describe("edge cases", () => {
    it.each(UNENGAGED)("releases a stems landing found in %s, since the pipeline put those stems there", status => {
      expect(decideCrossfadeLanding(landing("stems", status))).toBe("release");
    });

    it("releases after a failure that lands mid fade rather than claiming sing-along over it", () => {
      expect(decideCrossfadeLanding(landing("stems", "failed"))).toBe("release");
    });

    it("releases when a reacquire reset the pipeline while the fade was in flight", () => {
      expect(decideCrossfadeLanding(landing("stems", "waiting-for-capture"))).toBe("release");
      expect(decideCrossfadeLanding(landing("stems", "processing"))).toBe("release");
    });
  });

  describe("invariants", () => {
    it("never releases a deck the pipeline was engaged on", () => {
      for (const kind of KINDS) {
        expect(decideCrossfadeLanding(landing(kind, "engaged"))).not.toBe("release");
      }
    });

    it("never releases a mix landing in any pipeline state, since the page world owns that deck", () => {
      for (const status of STATUSES) {
        expect(decideCrossfadeLanding(landing("mix", status))).not.toBe("release");
      }
    });

    it("only ever calls a stems landing finished", () => {
      for (const kind of KINDS) {
        for (const status of STATUSES) {
          for (const separating of SEPARATING) {
            if (decideCrossfadeLanding(landing(kind, status, separating)) !== "keep-deck") continue;
            expect(kind).toBe("stems");
          }
        }
      }
    });

    it("never leaves a mix landing unseparated, since the fader would claim a sing-along over it", () => {
      for (const status of STATUSES) {
        for (const separating of SEPARATING) {
          expect(decideCrossfadeLanding(landing("mix", status, separating))).not.toBe("keep-deck");
        }
      }
    });

    it("only asks for a reacquire on a mix landing, which is the only kind that arrives unseparated", () => {
      for (const kind of KINDS) {
        for (const status of STATUSES) {
          if (decideCrossfadeLanding(landing(kind, status)) !== "keep-deck-and-reacquire") continue;
          expect(kind).toBe("mix");
        }
      }
    });

    it("never asks for a stems landing to be reacquired while separation is off, since nothing would answer", () => {
      for (const status of STATUSES) {
        expect(decideCrossfadeLanding(landing("stems", status, false))).not.toBe("keep-deck-and-reacquire");
      }
    });

    it("answers a mix landing the same way however the separation setting stands", () => {
      for (const status of STATUSES) {
        expect(decideCrossfadeLanding(landing("mix", status, false))).toBe(
          decideCrossfadeLanding(landing("mix", status, true))
        );
      }
    });

    it("is a pure decision, since the landing can be observed more than once", () => {
      for (const kind of KINDS) {
        for (const status of STATUSES) {
          const input = landing(kind, status);
          expect(decideCrossfadeLanding(input)).toBe(decideCrossfadeLanding(input));
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: a mix landing does not release the deck", () => {
      expect(decideCrossfadeLanding(landing("mix", "engaged"))).not.toBe("release");
    });

    it("regression: with separation off the pipeline never engages, and a mix landing must still keep its deck", () => {
      for (const status of UNENGAGED) {
        expect(decideCrossfadeLanding(landing("mix", status))).toBe("keep-deck-and-reacquire");
      }
    });

    it("regression: a mix landing asks for the track to be acquired", () => {
      expect(decideCrossfadeLanding(landing("mix", "engaged"))).toBe("keep-deck-and-reacquire");
    });

    it("regression: a stems landing is unchanged", () => {
      expect(decideCrossfadeLanding(landing("stems", "engaged"))).toBe("keep-deck");
    });

    it("regression: with separation off a stems landing keeps its deck, since nothing will ever engage", () => {
      for (const status of STATUSES) {
        expect(decideCrossfadeLanding(landing("stems", status, false))).toBe("keep-deck");
      }
    });

    it("regression: a mix landing with separation off is not reported as engaged stems", () => {
      for (const status of STATUSES) {
        expect(decideCrossfadeLanding(landing("mix", status, false))).toBe("keep-deck-and-reacquire");
      }
    });

    it("regression: with separation off a landing is never released a second after the fade", () => {
      for (const kind of KINDS) {
        for (const status of STATUSES) {
          expect(decideCrossfadeLanding(landing(kind, status, false))).not.toBe("release");
        }
      }
    });
  });
});
