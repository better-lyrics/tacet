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

const SILENCE_RMS = 1e-4;

interface IncomingStems {
  durationSeconds: number;
  vocalsRms: number | null;
  instrumentalRms: number;
  fadeSeconds: number;
}

function judgeIncomingStems(input: IncomingStems): CrossfadeGate {
  const { durationSeconds, vocalsRms, instrumentalRms, fadeSeconds } = input;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { kind: "refuse", reason: `the incoming audio is ${durationSeconds} s long` };
  }
  if (durationSeconds < fadeSeconds) {
    return {
      kind: "refuse",
      reason: `the incoming audio is ${durationSeconds.toFixed(1)} s, shorter than the ${fadeSeconds} s fade`,
    };
  }
  if (!Number.isFinite(instrumentalRms) || (vocalsRms !== null && !Number.isFinite(vocalsRms))) {
    return { kind: "refuse", reason: "the incoming audio measured as non-finite" };
  }

  const vocalsSilent = vocalsRms === null || vocalsRms < SILENCE_RMS;
  if (vocalsSilent && instrumentalRms < SILENCE_RMS) {
    return { kind: "refuse", reason: "the incoming audio is silent" };
  }
  return { kind: "allow" };
}

// -- Fitting the fade to the audio that is actually staged --------------------

type ClampedFade = { kind: "fade"; seconds: number } | { kind: "refuse"; reason: string };

function clampFadeToAudio(fadeSeconds: number, audioSeconds: number, minimumFadeSeconds: number): ClampedFade {
  if (!Number.isFinite(fadeSeconds) || fadeSeconds <= 0) {
    return { kind: "refuse", reason: `a crossfade needs a positive length, got ${fadeSeconds}` };
  }
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) {
    return { kind: "refuse", reason: `the staged audio is ${audioSeconds} s long` };
  }
  if (audioSeconds >= fadeSeconds) return { kind: "fade", seconds: fadeSeconds };
  if (audioSeconds < minimumFadeSeconds) {
    return {
      kind: "refuse",
      reason: `the staged audio is ${audioSeconds.toFixed(1)} s, too short to fade over`,
    };
  }
  return { kind: "fade", seconds: audioSeconds };
}

export { SILENCE_RMS, clampFadeToAudio, decideCrossfade, judgeIncomingStems };
export type { ClampedFade, CrossfadeGate, CrossfadeGateInput, IncomingStems };
