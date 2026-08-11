// -- Transition cue ----------------------------------------------------------

// Measured on six real cached tracks in the offscreen document: Opus decodes at
// 346 to 387 times realtime, worst case 633 ms for a 232 s track. The lead is
// what it is for margin under load, not because decoding is slow, and every
// second of it is a second holding a second track's PCM: 141 to 171 MB each.
// Decoding only the head the fade needs would save none of that, because the
// whole track has to be resident the moment the fade ends.
const DECODE_LEAD_SECONDS = 6;

// Below this a fade is a cut rather than a crossfade, so it is the point at
// which a late transition is abandoned instead of shortened further.
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

  // A track that stages late used to lose its transition outright, because
  // anything short of "ready" past the fade point was fatal. Staging late is
  // the common case, not the exception, and decoding is measured in hundreds
  // of milliseconds against seconds of remaining track, so there is almost
  // always time to make a shorter fade instead of none at all.
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
