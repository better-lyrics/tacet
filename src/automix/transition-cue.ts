// -- Transition cue ----------------------------------------------------------

const DECODE_LEAD_SECONDS = 6;

const MINIMUM_FADE_SECONDS = 1.5;

type StagedState = "none" | "encoded" | "decoding" | "ready";

interface TransitionCueInput {
  remainingSeconds: number;
  fadeSeconds: number;
  decodeLeadSeconds: number;
  pollIntervalSeconds: number;
  staged: StagedState;
  crossfading: boolean;
}

type TransitionCue =
  | { kind: "wait" }
  | { kind: "decode" }
  | { kind: "fade"; startInSeconds: number; durationSeconds: number }
  | { kind: "skip"; reason: string };

function decideTransitionCue(input: TransitionCueInput): TransitionCue {
  const { remainingSeconds, fadeSeconds, decodeLeadSeconds, pollIntervalSeconds, staged, crossfading } = input;

  if (crossfading) return { kind: "wait" };
  if (staged === "none") return { kind: "wait" };
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return { kind: "wait" };
  if (!Number.isFinite(fadeSeconds) || fadeSeconds <= 0) {
    return { kind: "skip", reason: `a transition needs a positive fade length, got ${fadeSeconds}` };
  }

  const lead = Number.isFinite(pollIntervalSeconds) && pollIntervalSeconds > 0 ? pollIntervalSeconds : 0;
  const fadeAt = fadeSeconds + lead;

  if (remainingSeconds > fadeAt) {
    if (staged !== "encoded") return { kind: "wait" };
    return remainingSeconds > fadeAt + decodeLeadSeconds ? { kind: "wait" } : { kind: "decode" };
  }

  if (staged === "ready") {
    return {
      kind: "fade",
      startInSeconds: Math.max(0, remainingSeconds - fadeSeconds),
      durationSeconds: Math.min(fadeSeconds, remainingSeconds),
    };
  }

  const tooLateToBother = `the staged track was still ${staged} with ${remainingSeconds.toFixed(1)} s left`;
  if (staged === "encoded") {
    return remainingSeconds > lead + MINIMUM_FADE_SECONDS
      ? { kind: "decode" }
      : { kind: "skip", reason: tooLateToBother };
  }
  return remainingSeconds >= MINIMUM_FADE_SECONDS ? { kind: "wait" } : { kind: "skip", reason: tooLateToBother };
}

export { DECODE_LEAD_SECONDS, MINIMUM_FADE_SECONDS, decideTransitionCue };
export type { StagedState, TransitionCue, TransitionCueInput };
