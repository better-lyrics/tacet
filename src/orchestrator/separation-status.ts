import type { KaraokeState } from "@/orchestrator/karaoke-state";

// -- The pipeline, said in three words -----------------------------------------
interface SeparationStatus {
  label: string;
  percent: number | null;
  fill: number;
}

const STAGE_LABELS: Record<string, string> = {
  "checking-cache": "Checking",
  decoding: "Decoding",
  "downloading-model": "Downloading model",
  "loading-model": "Loading model",
  separating: "Separating",
  encoding: "Finishing",
};

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function segmentFraction(state: KaraokeState): number {
  return state.total > 0 ? clampFraction(state.processed / state.total) : 0;
}

function describeProcessing(state: KaraokeState): SeparationStatus {
  const fill = segmentFraction(state);
  if (state.stage === "separating") {
    return { label: "Separating", percent: state.total > 0 ? fill : null, fill };
  }
  return { label: state.stage === null ? "Preparing" : STAGE_LABELS[state.stage] ?? "Preparing", percent: null, fill };
}

function describeSeparation(state: KaraokeState | null): SeparationStatus | null {
  if (state === null) return null;

  switch (state.status) {
    case "engaged":
      return { label: "Ready", percent: null, fill: 1 };
    case "failed":
      return { label: "Unavailable", percent: null, fill: 0 };
    case "ready-to-engage":
      return { label: "Tap to separate", percent: null, fill: 0 };
    case "processing":
      return describeProcessing(state);
    case "waiting-for-capture":
      if (state.downloadSource === null) return { label: "Waiting for audio", percent: null, fill: 0 };
      return {
        label: state.downloadSource === "hidden-player" ? "Downloading track" : "Buffering",
        percent: Number.isFinite(state.downloadFraction) ? clampFraction(state.downloadFraction) : null,
        fill: 0,
      };
    default:
      return null;
  }
}

function separationFill(status: SeparationStatus | null): number {
  return status === null ? 0 : status.fill;
}

function separationText(status: SeparationStatus | null): string {
  if (status === null) return "";
  if (status.percent === null) return status.label;
  return `${status.label} ${Math.round(status.percent * 100)}%`;
}

export { describeSeparation, separationFill, separationText };
export type { SeparationStatus };
