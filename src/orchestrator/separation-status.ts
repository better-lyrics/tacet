import { needsStarting } from "@/acquisition/sources";
import type { SeparationActivity, SeparationWork } from "@/orchestrator/separation-activity";

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

function segmentFraction(work: SeparationWork): number {
  return work.total > 0 ? clampFraction(work.processed / work.total) : 0;
}

function describeProcessing(work: SeparationWork): SeparationStatus {
  const fill = segmentFraction(work);
  if (work.stage === "separating") {
    return { label: "Separating", percent: work.total > 0 ? fill : null, fill };
  }
  return { label: work.stage === null ? "Preparing" : STAGE_LABELS[work.stage] ?? "Preparing", percent: null, fill };
}

function describeSeparation(activity: SeparationActivity): SeparationStatus | null {
  switch (activity.kind) {
    case "off":
      return null;
    case "asking":
      return { label: "Tap to separate", percent: null, fill: 0 };
    case "waiting":
      return { label: "Waiting for audio", percent: null, fill: 0 };
    case "downloading":
      return {
        label: needsStarting(activity.source) ? "Downloading track" : "Buffering",
        percent: Number.isFinite(activity.fraction) ? clampFraction(activity.fraction) : null,
        fill: 0,
      };
    case "working":
      return describeProcessing(activity);
    case "ready-to-engage":
      return { label: "Tap to separate", percent: null, fill: 0 };
    case "engaged":
      return { label: "Ready", percent: null, fill: 1 };
    case "failed":
      return { label: "Unavailable", percent: null, fill: 0 };
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
