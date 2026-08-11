// -- How a particular fade runs, once it is allowed to ------------------------

const PLAYER_REWIND_TOLERANCE_SECONDS = 1;

type AdvanceDecision = "advance" | "already-there" | "moved-on";

interface AdvanceInput {
  listenerVideoId: string | null;
  intoVideoId: string;
  elementMovedOn: boolean;
  playerPositionSeconds: number;
  positionWhenScheduledSeconds: number;
}

function playerRewound(input: AdvanceInput): boolean {
  if (!Number.isFinite(input.playerPositionSeconds)) return false;
  if (!Number.isFinite(input.positionWhenScheduledSeconds)) return false;
  return input.playerPositionSeconds < input.positionWhenScheduledSeconds - PLAYER_REWIND_TOLERANCE_SECONDS;
}

function decideAdvance(input: AdvanceInput): AdvanceDecision {
  if (input.listenerVideoId === input.intoVideoId) return "already-there";
  if (input.elementMovedOn || playerRewound(input)) return "moved-on";
  return "advance";
}

function advanceDelaySeconds(outgoing: "deck" | "original", fadeSeconds: number, leadSeconds: number): number {
  if (!Number.isFinite(fadeSeconds) || fadeSeconds <= 0) return 0;
  if (outgoing === "deck") return fadeSeconds / 2;
  if (!Number.isFinite(leadSeconds) || leadSeconds < 0) return fadeSeconds;
  return Math.max(0, fadeSeconds - leadSeconds);
}

export { advanceDelaySeconds, decideAdvance, PLAYER_REWIND_TOLERANCE_SECONDS };
export type { AdvanceDecision, AdvanceInput };
