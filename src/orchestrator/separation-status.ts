import type { KaraokeState } from "@/orchestrator/karaoke-state";

// -- The pipeline, said in three words -----------------------------------------
//
// The same KaraokeState the fader's hover card reads, rendered short enough to
// sit at the end of a popup row. describeBusy in busy-tooltip.ts is the other
// renderer of that state and stays a full sentence, because a hover card has
// the room and this does not. Neither owns the state; KaraokeState does.

// The bar and the text are deliberately two different quantities. The bar is
// the separation's own progress and nothing else, so within a track it only
// ever moves forward: flat at nothing while the audio is being acquired, the
// segment count while stems are computed, held there through Finishing, full
// at Ready. Driving it from whatever number the text happens to be showing
// swept it backwards twice per track, once from the download's percentage to a
// separation starting at zero, and once from the last segment to a Finishing
// line that has no percentage at all. Measured on a real track: 95% to 0 over
// 420ms, right at the finish line.
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

// Progress events only fire while stems are being computed, so this is zero
// before separation starts and holds its last value for every stage after it.
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
