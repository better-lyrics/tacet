// -- Bringing the player's clock onto the deck after a transition -------------

const ALIGN_TOLERANCE_SECONDS = 0.12;
const ALIGN_ACCEPTABLE_SECONDS = 0.5;
// A transition leaves the player at most a fade behind the deck. Anything wider
// than this is the listener having moved, and chasing it seeks them backwards.
const ALIGN_MAX_DRIFT_SECONDS = 20;

type AlignDecision =
  | { kind: "seek"; toSeconds: number; driftSeconds: number; nextLeadSeconds: number }
  | { kind: "wait"; reason: string }
  | { kind: "settled"; driftSeconds: number }
  | { kind: "moved-on"; reason: string }
  | { kind: "abandon"; reason: string };

interface AlignInput {
  playerVideoId: string | null;
  intoVideoId: string;
  playerPositionSeconds: number;
  deckPositionSeconds: number;
  leadSeconds: number;
  seeksSoFar: number;
  maxSeeks: number;
  waitedMs: number;
  patienceMs: number;
  toleranceSeconds?: number;
  acceptableSeconds?: number;
  maxDriftSeconds?: number;
}

function decideAlignment(input: AlignInput): AlignDecision {
  const tolerance = input.toleranceSeconds ?? ALIGN_TOLERANCE_SECONDS;
  const acceptable = Math.max(tolerance, input.acceptableSeconds ?? ALIGN_ACCEPTABLE_SECONDS);
  const outOfPatience = input.waitedMs >= input.patienceMs;

  if (input.playerVideoId !== input.intoVideoId) {
    const on = input.playerVideoId ?? "nothing";
    return outOfPatience
      ? { kind: "moved-on", reason: `the listener is on ${on} rather than ${input.intoVideoId}` }
      : { kind: "wait", reason: `the player is on ${on} rather than ${input.intoVideoId}` };
  }

  const drift = input.deckPositionSeconds - input.playerPositionSeconds;
  if (!Number.isFinite(drift)) {
    const reason = `the deck reads ${input.deckPositionSeconds} against a player at ${input.playerPositionSeconds}`;
    return outOfPatience ? { kind: "abandon", reason } : { kind: "wait", reason };
  }

  const maxDrift = input.maxDriftSeconds ?? ALIGN_MAX_DRIFT_SECONDS;
  if (Math.abs(drift) > maxDrift) {
    return { kind: "moved-on", reason: `the clocks are ${drift.toFixed(1)} s apart, the listener has moved` };
  }

  if (Math.abs(drift) <= tolerance) return { kind: "settled", driftSeconds: drift };
  if (input.seeksSoFar >= input.maxSeeks) {
    return Math.abs(drift) <= acceptable
      ? { kind: "settled", driftSeconds: drift }
      : { kind: "abandon", reason: `still ${drift.toFixed(2)} s apart after ${input.seeksSoFar} seek(s)` };
  }

  const lead = Number.isFinite(input.leadSeconds) ? input.leadSeconds : 0;
  const nextLead = input.seeksSoFar === 0 ? 0 : lead + drift;
  return {
    kind: "seek",
    toSeconds: Math.max(0, input.deckPositionSeconds + nextLead),
    driftSeconds: drift,
    nextLeadSeconds: nextLead,
  };
}

export { ALIGN_ACCEPTABLE_SECONDS, ALIGN_MAX_DRIFT_SECONDS, ALIGN_TOLERANCE_SECONDS, decideAlignment };
export type { AlignDecision, AlignInput };
