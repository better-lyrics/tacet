import type { KaraokeState } from "@/orchestrator/karaoke-state";

// -- The pipeline, said in three words -----------------------------------------
//
// The same KaraokeState the fader's hover card reads, rendered short enough to
// sit at the end of a popup row. describeBusy in busy-tooltip.ts is the other
// renderer of that state and stays a full sentence, because a hover card has
// the room and this does not. Neither owns the state; KaraokeState does.

interface SeparationStatus {
  label: string;
  percent: number | null;
  complete: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  "checking-cache": "Checking",
  decoding: "Decoding",
  "downloading-model": "Downloading model",
  "loading-model": "Loading model",
  separating: "Separating",
  encoding: "Finishing",
};

function working(label: string, percent: number | null = null): SeparationStatus {
  return { label, percent, complete: false };
}

function describeProcessing(state: KaraokeState): SeparationStatus {
  if (state.stage === "separating") {
    return working("Separating", state.total > 0 ? state.processed / state.total : null);
  }
  return working(state.stage === null ? "Preparing" : STAGE_LABELS[state.stage] ?? "Preparing");
}

function describeSeparation(state: KaraokeState | null): SeparationStatus | null {
  if (state === null) return null;

  switch (state.status) {
    case "engaged":
      return { label: "Ready", percent: null, complete: true };
    case "failed":
      return working("Unavailable");
    case "ready-to-engage":
      return working("Tap to separate");
    case "processing":
      return describeProcessing(state);
    case "waiting-for-capture":
      if (state.downloadSource === null) return working("Waiting for audio");
      return working(
        state.downloadSource === "hidden-player" ? "Downloading track" : "Buffering",
        Number.isFinite(state.downloadFraction) ? state.downloadFraction : null
      );
    default:
      return null;
  }
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function separationFill(status: SeparationStatus | null): number {
  if (status === null) return 0;
  if (status.complete) return 1;
  return status.percent === null ? 0 : clampFraction(status.percent);
}

function separationText(status: SeparationStatus | null): string {
  if (status === null) return "";
  if (status.percent === null) return status.label;
  return `${status.label} ${Math.round(clampFraction(status.percent) * 100)}%`;
}

export { describeSeparation, separationFill, separationText };
export type { SeparationStatus };
