// -- What the listener is actually hearing ------------------------------------

type AudibleSource = "deck" | "original" | "none";

interface AudibleSourceInput {
  bypassed: boolean;
  deckPlaying: boolean;
  elementPaused: boolean;
  originalGain: number;
}

function audibleSource(input: AudibleSourceInput): AudibleSource {
  if (!input.bypassed && input.deckPlaying) return "deck";
  if (!input.elementPaused && input.originalGain > 0) return "original";
  return "none";
}

export { audibleSource };
export type { AudibleSource, AudibleSourceInput };
