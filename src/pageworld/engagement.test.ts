import { describe, expect, it } from "vitest";
import { DURATION_AGREEMENT_S } from "@/capture/settled-duration";
import { decideEngagement, reconfirmAfterEmptied } from "@/pageworld/engagement";
import type { EngagementInput, ReconfirmInput } from "@/pageworld/engagement";

function input(overrides: Partial<EngagementInput> = {}): EngagementInput {
  return {
    hasStems: true,
    graph: "none",
    boundElementConnected: false,
    target: "same",
    acquiring: false,
    stemsEngaged: true,
    stemsAudible: true,
    standDown: false,
    stemsAreStale: false,
    ...overrides,
  };
}

const bound = { graph: "bound", boundElementConnected: true } as const;

describe("decideEngagement", () => {
  it("does nothing without stems", () => {
    expect(decideEngagement(input({ hasStems: false, target: "other" }))).toBe("idle");
  });

  it("engages once the stems' element can be identified", () => {
    expect(decideEngagement(input({ graph: "none", target: "same" }))).toBe("engage");
  });

  it("holds while a build is already in flight", () => {
    expect(decideEngagement(input({ graph: "none", acquiring: true }))).toBe("hold");
  });

  it("holds an engaged graph whose element is still the right one", () => {
    expect(decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "same" }))).toBe("hold");
  });

  it("rebinds when another element turns out to be the stems' element", () => {
    expect(decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "other" }))).toBe("rebind");
  });

  it("rebinds when the element it was bound to has been removed", () => {
    expect(decideEngagement(input({ graph: "bound", boundElementConnected: false, target: "same" }))).toBe("rebind");
  });

  describe("regressions", () => {
    it("holds an engaged graph while the target cannot be identified", () => {
      expect(decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "none" }))).toBe("hold");
    });

    it("does not engage against an element that cannot be identified yet", () => {
      expect(decideEngagement(input({ graph: "none", target: "none" }))).toBe("hold");
    });

    it("loads new stems into the graph already bound to their element", () => {
      expect(
        decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "same", stemsEngaged: false }))
      ).toBe("load");
    });

    it("waits rather than loading stems it cannot confirm the element for", () => {
      expect(
        decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "none", stemsEngaged: false }))
      ).toBe("hold");
    });

    it("releases stems the moment the player names a different track", () => {
      expect(
        decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "none", stemsAreStale: true }))
      ).toBe("release");
    });

    it("releases even while the stems it holds are the engaged ones", () => {
      expect(
        decideEngagement(
          input({ graph: "bound", boundElementConnected: true, stemsEngaged: true, stemsAreStale: true })
        )
      ).toBe("release");
    });

    it("still rebinds off a removed element rather than releasing", () => {
      expect(decideEngagement(input({ graph: "bound", boundElementConnected: false, stemsAreStale: true }))).toBe(
        "rebind"
      );
    });

    it("does not release when no graph is bound", () => {
      expect(decideEngagement(input({ graph: "none", target: "none", stemsAreStale: true }))).toBe("hold");
    });

    it("regression: suspends the stems for an ad the player does not admit to", () => {
      for (const target of ["same", "none"] as const) {
        expect(decideEngagement(input({ ...bound, target, standDown: true }))).toBe("suspend");
      }
    });

    it("regression: resumes the same stems afterwards rather than reloading them", () => {
      expect(decideEngagement(input({ ...bound, stemsAudible: false }))).toBe("resume");
    });
  });

  describe("ad breaks", () => {
    it("leaves suspended stems alone for the rest of the break", () => {
      expect(decideEngagement(input({ ...bound, standDown: true, stemsAudible: false }))).toBe("hold");
    });

    it("does not claim an element while an ad is on it", () => {
      expect(decideEngagement(input({ graph: "none", target: "same", standDown: true }))).toBe("hold");
    });

    it("waits out the ad before judging whether the stems went stale", () => {
      expect(decideEngagement(input({ ...bound, standDown: true, stemsAreStale: true }))).toBe("suspend");
      expect(decideEngagement(input({ ...bound, standDown: false, stemsAreStale: true }))).toBe("release");
    });

    it("still rebinds off a removed element mid-ad", () => {
      expect(decideEngagement(input({ graph: "bound", boundElementConnected: false, standDown: true }))).toBe("rebind");
    });

    it("loads stems that arrived during the break once it ends", () => {
      expect(decideEngagement(input({ ...bound, stemsEngaged: false, stemsAudible: false }))).toBe("load");
    });
  });

  describe("invariants", () => {
    it("never engages while a graph is already bound", () => {
      for (const connected of [true, false]) {
        for (const target of ["none", "same", "other"] as const) {
          expect(decideEngagement(input({ graph: "bound", boundElementConnected: connected, target }))).not.toBe(
            "engage"
          );
        }
      }
    });

    it("never acts at all without stems", () => {
      for (const graph of ["none", "bound"] as const) {
        for (const target of ["none", "same", "other"] as const) {
          expect(decideEngagement(input({ hasStems: false, graph, target, boundElementConnected: true }))).toBe("idle");
        }
      }
    });

    it("always rebinds off an element that has been removed", () => {
      for (const target of ["none", "same", "other"] as const) {
        expect(decideEngagement(input({ graph: "bound", boundElementConnected: false, target }))).toBe("rebind");
      }
    });

    it("never leaves stems audible through an ad", () => {
      for (const target of ["none", "same", "other"] as const) {
        for (const stale of [true, false]) {
          const action = decideEngagement(input({ ...bound, target, standDown: true, stemsAreStale: stale }));
          expect(action).not.toBe("hold");
          expect(action).not.toBe("resume");
          expect(action).not.toBe("load");
        }
      }
    });
  });
});

describe("reconfirmAfterEmptied", () => {
  const input = (overrides: Partial<ReconfirmInput> = {}): ReconfirmInput => ({
    playerVideoId: "DJCB1ZlseJ8",
    stemsVideoId: "DJCB1ZlseJ8",
    elementDurationSeconds: 215.1,
    clockDurationSeconds: 215.1,
    ...overrides,
  });

  it("confirms the same track reloaded at the same length", () => {
    expect(reconfirmAfterEmptied(input())).toBe("confirmed");
  });

  it("refuses a track the player has moved off", () => {
    expect(reconfirmAfterEmptied(input({ playerVideoId: "lYBUbBu4W08" }))).toBe("unconfirmed");
  });

  describe("regressions", () => {
    it("regression: lets the current track's stems come back", () => {
      expect(reconfirmAfterEmptied(input())).toBe("confirmed");
    });

    it("regression: refuses an ad running under the track's own id", () => {
      for (const adSeconds of [6, 20, 90, 133]) {
        expect(reconfirmAfterEmptied(input({ elementDurationSeconds: adSeconds }))).toBe("unconfirmed");
      }
    });

    it("regression: refuses the next track while the player still names the last", () => {
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 213 }))).toBe("unconfirmed");
    });

    it("regression: confirms stems that came out shorter than the track they belong to", () => {
      // 48 kHz Opus stems of a 219.4 s track measured 211.0 s. Judging the
      // element against the stems rejected that for ever, and the listener got
      // the whole track unseparated.
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 219.4, clockDurationSeconds: 219.4 }))).toBe(
        "confirmed"
      );
    });

    it("regression: confirms an element carrying a gapless append", () => {
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 430, clockDurationSeconds: 215.1 }))).toBe(
        "confirmed"
      );
    });
  });

  describe("edge cases", () => {
    it("refuses a player that names nothing yet", () => {
      expect(reconfirmAfterEmptied(input({ playerVideoId: null }))).toBe("unconfirmed");
    });

    it("refuses an element that has not loaded metadata", () => {
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: Number.NaN }))).toBe("unconfirmed");
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 0 }))).toBe("unconfirmed");
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: Number.POSITIVE_INFINITY }))).toBe("unconfirmed");
    });

    it("refuses a clock that has not settled on a track yet", () => {
      expect(reconfirmAfterEmptied(input({ clockDurationSeconds: Number.NaN }))).toBe("unconfirmed");
      expect(reconfirmAfterEmptied(input({ clockDurationSeconds: 0 }))).toBe("unconfirmed");
    });

    it("allows the drift a re-decode introduces", () => {
      const edge = DURATION_AGREEMENT_S;
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 215.1 - edge }))).toBe("confirmed");
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 215.1 - edge - 0.01 }))).toBe("unconfirmed");
    });
  });

  describe("invariants", () => {
    it("never confirms a track the player is not on, whatever the length", () => {
      for (const duration of [0, 1, 215.1, 1000]) {
        expect(reconfirmAfterEmptied(input({ playerVideoId: "other", elementDurationSeconds: duration }))).toBe(
          "unconfirmed"
        );
      }
    });
  });
});
