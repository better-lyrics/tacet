// -- How a particular fade runs, once it is allowed to ------------------------

import type { OutgoingSource } from "@/automix/crossfade-gate";

interface OutgoingSourceInput {
  bypassed: boolean;
  deckPlaying: boolean;
  elementPaused: boolean;
  originalGain: number;
}

function chooseOutgoingSource(input: OutgoingSourceInput): OutgoingSource {
  if (!input.bypassed && input.deckPlaying) return "deck";
  if (!input.elementPaused && input.originalGain > 0) return "original";
  return "none";
}

type AdvanceDecision = "advance" | "already-there" | "moved-on";

interface AdvanceInput {
  playerVideoId: string | null;
  intoVideoId: string;
  elementMovedOn: boolean;
}

function decideAdvance(input: AdvanceInput): AdvanceDecision {
  if (input.playerVideoId === input.intoVideoId) return "already-there";
  if (input.elementMovedOn) return "moved-on";
  return "advance";
}

function advanceDelaySeconds(outgoing: "deck" | "original", fadeSeconds: number, leadSeconds: number): number {
  if (!Number.isFinite(fadeSeconds) || fadeSeconds <= 0) return 0;
  if (outgoing === "deck") return fadeSeconds / 2;
  if (!Number.isFinite(leadSeconds) || leadSeconds < 0) return fadeSeconds;
  return Math.max(0, fadeSeconds - leadSeconds);
}

export { advanceDelaySeconds, chooseOutgoingSource, decideAdvance };
export type { AdvanceDecision, AdvanceInput, OutgoingSourceInput };
