// -- Drift correction ---------------------------------------------------------

const RESTART_DRIFT_TOLERANCE_S = 0.12;
const DRIFT_SEEK_LIMIT_S = 2;
const DRIFT_SEEK_SETTLE_S = 0.5;

type DriftCorrection =
  | { kind: "hold" }
  | { kind: "restart-deck"; reason: string }
  | { kind: "seek-player"; toSeconds: number; driftSeconds: number };

interface DriftInput {
  hasActiveSources: boolean;
  stemPositionSeconds: number;
  playerPositionSeconds: number;
  listenerSeeked: boolean;
  originalGain: number;
  elementStalled?: boolean;
  toleranceSeconds?: number;
  seekLimitSeconds?: number;
}

function decideDriftCorrection(input: DriftInput): DriftCorrection {
  if (!input.hasActiveSources) return { kind: "restart-deck", reason: "the deck is not playing" };
  if (!Number.isFinite(input.stemPositionSeconds) || !Number.isFinite(input.playerPositionSeconds)) {
    return { kind: "restart-deck", reason: "one of the two clocks is unreadable" };
  }

  const drift = input.playerPositionSeconds - input.stemPositionSeconds;
  const tolerance = input.toleranceSeconds ?? RESTART_DRIFT_TOLERANCE_S;
  if (Math.abs(drift) <= tolerance) return { kind: "hold" };

  if (input.listenerSeeked) return { kind: "restart-deck", reason: "the listener seeked and expects the jump" };
  if (input.elementStalled === true) return { kind: "hold" };
  if (input.originalGain > 0) {
    return { kind: "restart-deck", reason: "the listener is on the original, so seeking it would be heard" };
  }

  const limit = input.seekLimitSeconds ?? DRIFT_SEEK_LIMIT_S;
  if (Math.abs(drift) > limit) {
    return { kind: "restart-deck", reason: `the clocks are ${drift.toFixed(2)} s apart, too wide to be drift` };
  }
  return { kind: "seek-player", toSeconds: input.stemPositionSeconds, driftSeconds: drift };
}

export { decideDriftCorrection, DRIFT_SEEK_LIMIT_S, DRIFT_SEEK_SETTLE_S, RESTART_DRIFT_TOLERANCE_S };
export type { DriftCorrection, DriftInput };
