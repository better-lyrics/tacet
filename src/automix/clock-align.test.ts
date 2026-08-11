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
    expect(decideAlignment(input())).toEqual({ kind: "seek", toSeconds: 4, driftSeconds: 4, nextLeadSeconds: 0 });
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

  it("aims straight at the deck on the first seek, before any residue is known", () => {
    expect(decideAlignment(input({ deckPositionSeconds: 8, playerPositionSeconds: 0 }))).toMatchObject({
      kind: "seek",
      toSeconds: 8,
      nextLeadSeconds: 0,
    });
  });

  it("folds the residue of the last seek into the next aim", () => {
    const decision = decideAlignment(input({ seeksSoFar: 1, deckPositionSeconds: 8.7, playerPositionSeconds: 8.4 }));
    expect(decision).toMatchObject({ kind: "seek", nextLeadSeconds: expect.any(Number) });
    if (decision.kind === "seek") {
      expect(decision.nextLeadSeconds).toBeCloseTo(0.3, 5);
      expect(decision.toSeconds).toBeCloseTo(9, 5);
    }
  });

  it("keeps accumulating residues across later seeks", () => {
    const decision = decideAlignment({
      ...input({ seeksSoFar: 2, deckPositionSeconds: 10, playerPositionSeconds: 9.9 }),
      leadSeconds: 0.3,
      toleranceSeconds: 0.05,
    });
    if (decision.kind !== "seek") throw new Error(`expected a seek, got ${decision.kind}`);
    expect(decision.nextLeadSeconds).toBeCloseTo(0.4, 5);
    expect(decision.toSeconds).toBeCloseTo(10.4, 5);
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
      const decision = decideAlignment(
        input({ seeksSoFar: 1, deckPositionSeconds: 0.5, playerPositionSeconds: 4, leadSeconds: -2 })
      );
      expect(decision).toMatchObject({ kind: "seek", toSeconds: 0 });
    });

    it("treats a non-finite lead as no lead at all", () => {
      const decision = decideAlignment(input({ seeksSoFar: 1, leadSeconds: Number.NaN }));
      if (decision.kind !== "seek") throw new Error(`expected a seek, got ${decision.kind}`);
      expect(decision.nextLeadSeconds).toBeCloseTo(4, 5);
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

    it("does not fold the whole opening gap into the aim of the second seek", () => {
      const first = decideAlignment(input({ deckPositionSeconds: 8, playerPositionSeconds: 0.11 }));
      if (first.kind !== "seek") throw new Error(`expected a seek, got ${first.kind}`);
      expect(first.toSeconds).toBeCloseTo(8, 5);

      const second = decideAlignment(
        input({
          seeksSoFar: 1,
          leadSeconds: first.nextLeadSeconds,
          deckPositionSeconds: 8.7,
          playerPositionSeconds: 8.4,
        })
      );
      if (second.kind !== "seek") throw new Error(`expected a seek, got ${second.kind}`);
      expect(second.toSeconds).toBeCloseTo(9, 5);
    });

    it("converges rather than diverging over three seeks against a fixed seek latency", () => {
      const latency = 0.3;
      let lead = 0;
      let deck = 8;
      let player = 0;
      const drifts = [];
      for (let seeks = 0; seeks < 3; seeks++) {
        const decision = decideAlignment(
          input({ seeksSoFar: seeks, leadSeconds: lead, deckPositionSeconds: deck, playerPositionSeconds: player })
        );
        if (decision.kind !== "seek") break;
        lead = decision.nextLeadSeconds;
        player = decision.toSeconds - latency;
        deck += 0.7;
        player += 0.7;
        drifts.push(deck - player);
      }
      expect(Math.abs(drifts[drifts.length - 1])).toBeLessThan(Math.abs(drifts[0]));
      expect(Math.abs(drifts[drifts.length - 1])).toBeLessThan(0.05);
    });
  });
});
