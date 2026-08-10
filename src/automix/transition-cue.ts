// -- Transition cue ----------------------------------------------------------

const DECODE_LEAD_SECONDS = 15;

type StagedState = "none" | "encoded" | "decoding" | "ready";

interface TransitionCueInput {
  remainingSeconds: number;
  fadeSeconds: number;
  decodeLeadSeconds: number;
  staged: StagedState;
  crossfading: boolean;
}

type TransitionCue = { kind: "wait" } | { kind: "decode" } | { kind: "fade" } | { kind: "skip"; reason: string };

function decideTransitionCue(input: TransitionCueInput): TransitionCue {
  const { remainingSeconds, fadeSeconds, decodeLeadSeconds, staged, crossfading } = input;

  if (crossfading) return { kind: "wait" };
  if (staged === "none") return { kind: "wait" };
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return { kind: "wait" };
  if (!Number.isFinite(fadeSeconds) || fadeSeconds <= 0) {
    return { kind: "skip", reason: `a transition needs a positive fade length, got ${fadeSeconds}` };
  }

  if (remainingSeconds > fadeSeconds) {
    if (staged !== "encoded") return { kind: "wait" };
    return remainingSeconds > fadeSeconds + decodeLeadSeconds ? { kind: "wait" } : { kind: "decode" };
  }

  if (staged === "ready") return { kind: "fade" };
  return { kind: "skip", reason: `the staged track was still ${staged} with ${remainingSeconds.toFixed(1)} s left` };
}

export { DECODE_LEAD_SECONDS, decideTransitionCue };
export type { StagedState, TransitionCue, TransitionCueInput };
