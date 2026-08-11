// -- Bringing the player's clock onto the deck after a transition -------------

const ALIGN_TOLERANCE_SECONDS = 0.12;

type AlignDecision =
  | { kind: "seek"; toSeconds: number; driftSeconds: number; nextLeadSeconds: number }
  | { kind: "wait"; reason: string }
  | { kind: "settled"; driftSeconds: number }
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
}

function decideAlignment(input: AlignInput): AlignDecision {
  const tolerance = input.toleranceSeconds ?? ALIGN_TOLERANCE_SECONDS;
  const outOfPatience = input.waitedMs >= input.patienceMs;

  if (input.playerVideoId !== input.intoVideoId) {
    const on = input.playerVideoId ?? "nothing";
    return outOfPatience
      ? { kind: "abandon", reason: `the player never reached ${input.intoVideoId}, it is on ${on}` }
      : { kind: "wait", reason: `the player is on ${on} rather than ${input.intoVideoId}` };
  }

  const drift = input.deckPositionSeconds - input.playerPositionSeconds;
  if (!Number.isFinite(drift)) {
    const reason = `the deck reads ${input.deckPositionSeconds} against a player at ${input.playerPositionSeconds}`;
    return outOfPatience ? { kind: "abandon", reason } : { kind: "wait", reason };
  }

  if (Math.abs(drift) <= tolerance) return { kind: "settled", driftSeconds: drift };
  if (input.seeksSoFar >= input.maxSeeks) {
    return { kind: "abandon", reason: `still ${drift.toFixed(2)} s apart after ${input.seeksSoFar} seek(s)` };
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

export { ALIGN_TOLERANCE_SECONDS, decideAlignment };
export type { AlignDecision, AlignInput };
