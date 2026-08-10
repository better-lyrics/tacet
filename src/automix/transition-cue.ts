// -- Transition cue ----------------------------------------------------------

const DECODE_LEAD_SECONDS = 15;

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

// The cue is polled, so it is asked one poll early and hands back a delay and a
// length whose sum is exactly the time left. Fading from "now" for the full
// length instead leaves the outgoing buffer empty while its curve is still
// above zero, which is an audible dip rather than a rounding error: measured at
// 56 % of the surrounding level. A cue that arrives late shortens the fade for
// the same reason.
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
  return { kind: "skip", reason: `the staged track was still ${staged} with ${remainingSeconds.toFixed(1)} s left` };
}

export { DECODE_LEAD_SECONDS, decideTransitionCue };
export type { StagedState, TransitionCue, TransitionCueInput };
