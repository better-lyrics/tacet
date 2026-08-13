// -- How often a shadow player may be built --------------------------------------

// Minting is cheap for the page and expensive for the session. Measured on a real
// signed-in account: 31 mints in 4.5 minutes, roughly one every nine seconds, and
// the page stopped issuing content-bound tokens altogether. It emitted only
// 16 character cold-start tokens afterwards, for the listener's own player as well
// as for ours, and it had not recovered 40 minutes later or across a page reload.
//
// Nothing upstream documents a mint-count cap, so what this guards against is
// measured rather than specified. The listener never notices directly, because a
// cold-start token still serves one to two megabytes and the player simply asks
// again, but our own acquisition stops working entirely. So the rule is: mint no
// faster than a listener actually changes track, and stop completely once the page
// starts answering with cold-start tokens rather than pulling harder.

const MIN_INTERVAL_MS = 45_000;

const FAILURES_BEFORE_STANDING_DOWN = 2;

const STAND_DOWN_MS = 30 * 60_000;

interface ShadowBudget {
  lastMintStartedAt: number | null;
  consecutiveFailures: number;
  stoodDownAt: number | null;
}

interface BudgetVerdict {
  allowed: boolean;
  reason: string;
}

function freshBudget(): ShadowBudget {
  return { lastMintStartedAt: null, consecutiveFailures: 0, stoodDownAt: null };
}

function mayMint(budget: ShadowBudget, now: number): BudgetVerdict {
  if (budget.stoodDownAt !== null) {
    const waited = now - budget.stoodDownAt;
    if (waited < STAND_DOWN_MS) {
      const minutes = Math.ceil((STAND_DOWN_MS - waited) / 60_000);
      return { allowed: false, reason: `the page stopped attesting, so this source stands down for ${minutes}m` };
    }
  }
  if (budget.lastMintStartedAt !== null && now - budget.lastMintStartedAt < MIN_INTERVAL_MS) {
    const seconds = Math.ceil((MIN_INTERVAL_MS - (now - budget.lastMintStartedAt)) / 1000);
    return { allowed: false, reason: `the last mint was ${seconds}s ago, which is too soon to ask again` };
  }
  return { allowed: true, reason: "a mint is due" };
}

function recordMintStarted(budget: ShadowBudget, now: number): ShadowBudget {
  return { ...budget, lastMintStartedAt: now, stoodDownAt: null };
}

function recordMintOutcome(budget: ShadowBudget, attested: boolean, now: number): ShadowBudget {
  if (attested) return { ...budget, consecutiveFailures: 0, stoodDownAt: null };
  const consecutiveFailures = budget.consecutiveFailures + 1;
  const alreadyStoodDown = budget.stoodDownAt !== null;
  return {
    ...budget,
    consecutiveFailures,
    // The clock runs from the first refusal. Restarting it on every later failure
    // would let a run of them hold the source down for ever.
    stoodDownAt: alreadyStoodDown
      ? budget.stoodDownAt
      : consecutiveFailures >= FAILURES_BEFORE_STANDING_DOWN
        ? now
        : null,
  };
}

export {
  FAILURES_BEFORE_STANDING_DOWN,
  MIN_INTERVAL_MS,
  STAND_DOWN_MS,
  freshBudget,
  mayMint,
  recordMintOutcome,
  recordMintStarted,
};
export type { BudgetVerdict, ShadowBudget };
