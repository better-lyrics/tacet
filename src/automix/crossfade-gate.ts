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

export { decideCrossfade };
export type { CrossfadeGate, CrossfadeGateInput };
