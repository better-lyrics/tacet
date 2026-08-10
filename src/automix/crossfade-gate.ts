// -- Crossfade gate ----------------------------------------------------------

interface CrossfadeGateInput {
  crossfading: boolean;
  bypassed: boolean;
  outgoingPlaying: boolean;
  durationSeconds: number;
}

type CrossfadeGate = { kind: "allow" } | { kind: "refuse"; reason: string };

function decideCrossfade(input: CrossfadeGateInput): CrossfadeGate {
  if (input.crossfading) return { kind: "refuse", reason: "a crossfade is already in flight" };
  if (input.bypassed) return { kind: "refuse", reason: "the graph is handing back to the original" };
  if (!input.outgoingPlaying) return { kind: "refuse", reason: "nothing is playing to fade out of" };
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    return { kind: "refuse", reason: `a crossfade needs a positive duration, got ${input.durationSeconds}` };
  }
  return { kind: "allow" };
}

// -- What the incoming deck is actually holding -------------------------------

// Only answerable after the buffers exist, so it is a second judgement rather
// than more fields on the one above. Both failures render as a long fade to or
// from nothing rather than as an error, which is why they are refused here.
const SILENCE_RMS = 1e-4;

interface IncomingStems {
  durationSeconds: number;
  vocalsRms: number;
  instrumentalRms: number;
  fadeSeconds: number;
}

function judgeIncomingStems(input: IncomingStems): CrossfadeGate {
  const { durationSeconds, vocalsRms, instrumentalRms, fadeSeconds } = input;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { kind: "refuse", reason: `the incoming stems are ${durationSeconds} s long` };
  }
  if (durationSeconds < fadeSeconds) {
    return {
      kind: "refuse",
      reason: `the incoming stems are ${durationSeconds.toFixed(1)} s, shorter than the ${fadeSeconds} s fade`,
    };
  }
  if (!Number.isFinite(vocalsRms) || !Number.isFinite(instrumentalRms)) {
    return { kind: "refuse", reason: "the incoming stems measured as non-finite" };
  }
  if (vocalsRms < SILENCE_RMS && instrumentalRms < SILENCE_RMS) {
    return { kind: "refuse", reason: "the incoming stems are silent" };
  }
  return { kind: "allow" };
}

export { SILENCE_RMS, decideCrossfade, judgeIncomingStems };
export type { CrossfadeGate, CrossfadeGateInput, IncomingStems };
