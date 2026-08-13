// -- How often a shadow player may be built --------------------------------------

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
