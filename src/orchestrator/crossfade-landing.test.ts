import { describe, expect, it } from "vitest";
import { decideCrossfadeLanding } from "@/orchestrator/crossfade-landing";
import type { CrossfadeLandingInput, LandingKind } from "@/orchestrator/crossfade-landing";
import type { KaraokeStatus } from "@/orchestrator/karaoke-state";

const KINDS: LandingKind[] = ["stems", "mix"];
const STATUSES: KaraokeStatus[] = ["waiting-for-capture", "ready-to-engage", "processing", "engaged", "failed"];
const UNENGAGED: KaraokeStatus[] = STATUSES.filter(status => status !== "engaged");

function landing(kind: LandingKind, status: KaraokeStatus): CrossfadeLandingInput {
  return { kind, status };
}

describe("decideCrossfadeLanding", () => {
  it("is finished when the fade landed on separated stems", () => {
    expect(decideCrossfadeLanding(landing("stems", "engaged"))).toBe("keep-deck");
  });

  it("keeps the unseparated audio playing but sends the track off to be separated", () => {
    expect(decideCrossfadeLanding(landing("mix", "engaged"))).toBe("keep-deck-and-reacquire");
  });

  it("releases the deck when the pipeline was not the thing driving it", () => {
    expect(decideCrossfadeLanding(landing("stems", "waiting-for-capture"))).toBe("release");
    expect(decideCrossfadeLanding(landing("mix", "waiting-for-capture"))).toBe("release");
  });

  describe("edge cases", () => {
    it.each(UNENGAGED)("releases on a landing found in %s, whatever was faded in", status => {
      for (const kind of KINDS) {
        expect(decideCrossfadeLanding(landing(kind, status))).toBe("release");
      }
    });

    it("releases after a failure that lands mid fade rather than claiming sing-along over it", () => {
      expect(decideCrossfadeLanding(landing("stems", "failed"))).toBe("release");
      expect(decideCrossfadeLanding(landing("mix", "failed"))).toBe("release");
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

    it("only ever calls a stems landing finished", () => {
      for (const kind of KINDS) {
        for (const status of STATUSES) {
          if (decideCrossfadeLanding(landing(kind, status)) !== "keep-deck") continue;
          expect(kind).toBe("stems");
        }
      }
    });

    it("never leaves a mix landing unseparated, since the fader would claim a sing-along over it", () => {
      for (const status of STATUSES) {
        expect(decideCrossfadeLanding(landing("mix", status))).not.toBe("keep-deck");
      }
    });

    it("only asks for a reacquire on a landing it is also keeping", () => {
      for (const kind of KINDS) {
        for (const status of STATUSES) {
          if (decideCrossfadeLanding(landing(kind, status)) !== "keep-deck-and-reacquire") continue;
          expect(kind).toBe("mix");
          expect(status).toBe("engaged");
        }
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

    it("regression: a mix landing asks for the track to be acquired", () => {
      expect(decideCrossfadeLanding(landing("mix", "engaged"))).toBe("keep-deck-and-reacquire");
    });

    it("regression: a stems landing is unchanged", () => {
      expect(decideCrossfadeLanding(landing("stems", "engaged"))).toBe("keep-deck");
    });
  });
});
