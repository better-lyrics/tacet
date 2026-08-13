import {
  FAILURES_BEFORE_STANDING_DOWN,
  MIN_INTERVAL_MS,
  STAND_DOWN_MS,
  freshBudget,
  mayMint,
  recordMintOutcome,
  recordMintStarted,
} from "@/acquisition/shadow-budget";
import { describe, expect, it } from "vitest";

const failTimes = (budget: ReturnType<typeof freshBudget>, times: number, at: number) => {
  let next = budget;
  for (let i = 0; i < times; i += 1) next = recordMintOutcome(next, false, at);
  return next;
};

describe("mayMint", () => {
  it("allows the first mint of a session", () => {
    expect(mayMint(freshBudget(), 0).allowed).toBe(true);
  });

  it("allows another mint once a track's worth of time has passed", () => {
    const budget = recordMintStarted(freshBudget(), 0);
    expect(mayMint(budget, MIN_INTERVAL_MS).allowed).toBe(true);
  });

  it("refuses a second mint straight after the first", () => {
    const budget = recordMintStarted(freshBudget(), 0);
    const verdict = mayMint(budget, 1_000);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("too soon");
  });

  it("stands the source down once the page stops attesting", () => {
    const budget = failTimes(recordMintStarted(freshBudget(), 0), FAILURES_BEFORE_STANDING_DOWN, 1_000);
    const verdict = mayMint(budget, 2_000);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("stands down");
  });

  describe("edge cases", () => {
    it("comes back after the stand down elapses", () => {
      const budget = failTimes(freshBudget(), FAILURES_BEFORE_STANDING_DOWN, 0);
      expect(mayMint(budget, STAND_DOWN_MS - 1).allowed).toBe(false);
      expect(mayMint(budget, STAND_DOWN_MS).allowed).toBe(true);
    });

    it("does not stand down on a single failure, which is ordinary", () => {
      const budget = recordMintOutcome(freshBudget(), false, 0);
      expect(mayMint(budget, MIN_INTERVAL_MS).allowed).toBe(true);
    });

    it("counts the interval from when the mint started, not when it finished", () => {
      const budget = recordMintStarted(freshBudget(), 10_000);
      expect(mayMint(budget, 10_000 + MIN_INTERVAL_MS - 1).allowed).toBe(false);
      expect(mayMint(budget, 10_000 + MIN_INTERVAL_MS).allowed).toBe(true);
    });
  });

  describe("invariants", () => {
    it("never allows two mints inside the minimum interval, however the budget got there", () => {
      let budget = freshBudget();
      for (let t = 0; t < MIN_INTERVAL_MS * 3; t += 5_000) {
        if (mayMint(budget, t).allowed) {
          budget = recordMintStarted(budget, t);
          budget = recordMintOutcome(budget, true, t);
          const blocked = mayMint(budget, t + MIN_INTERVAL_MS - 1);
          expect(blocked.allowed).toBe(false);
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: a success clears the failure run so one bad track does not stand the source down later", () => {
      let budget = recordMintOutcome(freshBudget(), false, 0);
      budget = recordMintOutcome(budget, true, 1_000);
      budget = recordMintOutcome(budget, false, 2_000);
      expect(mayMint(budget, MIN_INTERVAL_MS).allowed).toBe(true);
    });

    it("regression: starting a mint clears a stand down so the retry after it is not blocked forever", () => {
      let budget = failTimes(freshBudget(), FAILURES_BEFORE_STANDING_DOWN, 0);
      budget = recordMintStarted(budget, STAND_DOWN_MS);
      expect(budget.stoodDownAt).toBeNull();
    });

    it("regression: a stand down survives further failures rather than resetting its clock", () => {
      let budget = failTimes(freshBudget(), FAILURES_BEFORE_STANDING_DOWN, 0);
      budget = recordMintOutcome(budget, false, STAND_DOWN_MS - 1_000);
      expect(mayMint(budget, STAND_DOWN_MS).allowed).toBe(true);
    });
  });
});
