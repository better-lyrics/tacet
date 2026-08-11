import { describe, expect, it } from "vitest";
import { decideAlignment } from "@/automix/clock-align";
import type { AlignInput } from "@/automix/clock-align";

function input(overrides: Partial<AlignInput> = {}): AlignInput {
  return {
    playerVideoId: "into",
    intoVideoId: "into",
    playerPositionSeconds: 0,
    deckPositionSeconds: 4,
    leadSeconds: 0,
    seeksSoFar: 0,
    maxSeeks: 3,
    waitedMs: 0,
    patienceMs: 12_000,
    ...overrides,
  };
}

describe("decideAlignment", () => {
  it("seeks the player onto the deck once both name the same track", () => {
    expect(decideAlignment(input())).toEqual({ kind: "seek", toSeconds: 4, driftSeconds: 4 });
  });

  it("is settled once the two clocks agree", () => {
    const decision = decideAlignment(input({ playerPositionSeconds: 4.05 }));
    expect(decision.kind).toBe("settled");
    if (decision.kind === "settled") expect(decision.driftSeconds).toBeCloseTo(-0.05, 5);
  });

  it("waits while the player still names the track we faded out of", () => {
    const decision = decideAlignment(input({ playerVideoId: "from" }));
    expect(decision.kind).toBe("wait");
  });

  it("folds the residue of the last attempt into the next aim", () => {
    expect(decideAlignment(input({ leadSeconds: 0.2 }))).toMatchObject({ kind: "seek", toSeconds: 4.2 });
  });

  describe("edge cases", () => {
    it("waits rather than giving up when the player has not named a track at all", () => {
      expect(decideAlignment(input({ playerVideoId: null })).kind).toBe("wait");
    });

    it("waits while the deck's clock is unreadable", () => {
      expect(decideAlignment(input({ deckPositionSeconds: Number.NaN })).kind).toBe("wait");
    });

    it("waits while the player's clock is unreadable", () => {
      expect(decideAlignment(input({ playerPositionSeconds: Number.NaN })).kind).toBe("wait");
    });

    it("gives up on an unreadable clock once patience runs out", () => {
      const decision = decideAlignment(input({ deckPositionSeconds: Number.NaN, waitedMs: 12_000 }));
      expect(decision.kind).toBe("abandon");
    });

    it("gives up once the player has had long enough to reach the track", () => {
      const decision = decideAlignment(input({ playerVideoId: "elsewhere", waitedMs: 12_000 }));
      expect(decision).toEqual({ kind: "abandon", reason: "the player never reached into, it is on elsewhere" });
    });

    it("gives up once the seek budget is spent", () => {
      expect(decideAlignment(input({ seeksSoFar: 3 })).kind).toBe("abandon");
    });

    it("never aims the player before the start of the track", () => {
      const decision = decideAlignment(input({ deckPositionSeconds: 0.5, playerPositionSeconds: 4, leadSeconds: -2 }));
      expect(decision).toMatchObject({ kind: "seek", toSeconds: 0 });
    });

    it("treats a non-finite lead as no lead at all", () => {
      expect(decideAlignment(input({ leadSeconds: Number.NaN }))).toMatchObject({ kind: "seek", toSeconds: 4 });
    });

    it("honours a caller's own tolerance", () => {
      expect(decideAlignment(input({ playerPositionSeconds: 3.5, toleranceSeconds: 1 })).kind).toBe("settled");
    });
  });

  describe("invariants", () => {
    it("only ever seeks while the player is on the track being faded into", () => {
      const decision = decideAlignment(input({ playerVideoId: "from", deckPositionSeconds: 90 }));
      expect(decision.kind).not.toBe("seek");
    });

    it("never spends a seek it has no budget for", () => {
      for (let seeks = 0; seeks <= 5; seeks++) {
        const decision = decideAlignment(input({ seeksSoFar: seeks, maxSeeks: 3 }));
        if (seeks >= 3) expect(decision.kind).toBe("abandon");
        else expect(decision.kind).toBe("seek");
      }
    });

    it("reaches a terminal answer for any input once patience and budget are spent", () => {
      const spent = { waitedMs: 20_000, patienceMs: 12_000, seeksSoFar: 3, maxSeeks: 3 };
      for (const playerVideoId of ["into", "from", null]) {
        for (const deckPositionSeconds of [0, 4, Number.NaN]) {
          const decision = decideAlignment(input({ ...spent, playerVideoId, deckPositionSeconds }));
          expect(["settled", "abandon"]).toContain(decision.kind);
        }
      }
    });
  });

  describe("regressions", () => {
    it("does not give up for good when the player still names the previous track", () => {
      const decision = decideAlignment(input({ playerVideoId: "from", waitedMs: 250 }));
      expect(decision.kind).toBe("wait");
    });

    it("corrects a player sitting at zero while the deck is most of a fade in", () => {
      const decision = decideAlignment(input({ playerPositionSeconds: 0, deckPositionSeconds: 7.9 }));
      expect(decision).toMatchObject({ kind: "seek", toSeconds: 7.9 });
    });

    it("does not seek backwards past the start when the deck is behind the player", () => {
      const decision = decideAlignment(input({ deckPositionSeconds: 1, playerPositionSeconds: 9 }));
      expect(decision).toMatchObject({ kind: "seek", toSeconds: 1, driftSeconds: -8 });
    });
  });
});
