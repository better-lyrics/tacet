import { describeDownload } from "@/orchestrator/download-tooltip";
import type { SeparationActivity, SeparationWork } from "@/orchestrator/separation-activity";
import { ARMED_LABEL } from "@/ui/armed-affordance";
import type { TooltipContent } from "@/ui/tooltip";

// -- Busy tooltip --------------------------------------------------------------

const ASKING_LABEL = "Click to separate this track";
const WAITING_LABEL = "Waiting for the audio…";
const ENGAGE_LABEL = "Click to remove vocals, hold to set the level";

function describeStage(work: SeparationWork): TooltipContent {
  switch (work.stage) {
    case "checking-cache":
      return { label: "Checking for cached vocals…", percent: null };
    case "decoding":
      return { label: "Decoding the captured track…", percent: null };
    case "downloading-model":
      return { label: "Downloading the separation model…", percent: null };
    case "loading-model":
      return { label: "Loading the separation model…", percent: null };
    case "separating":
      return { label: "Separating vocals…", percent: work.total > 0 ? work.processed / work.total : null };
    case "encoding":
      return { label: "Finishing up…", percent: null };
    default:
      return { label: "Preparing sing-along…", percent: null };
  }
}

function activityIsBusy(activity: SeparationActivity): boolean {
  return activity.kind === "waiting" || activity.kind === "downloading" || activity.kind === "working";
}

function describeActivity(activity: SeparationActivity, armed: boolean): TooltipContent | null {
  const note = armed ? ARMED_LABEL : null;

  switch (activity.kind) {
    case "off":
      return null;
    case "asking":
      return { label: ASKING_LABEL, percent: null };
    case "waiting":
      return { label: WAITING_LABEL, percent: null, note };
    case "downloading":
      return { ...describeDownload(activity.fraction, activity.source), note };
    case "working":
      return { ...describeStage(activity), note };
    case "ready-to-engage":
    case "engaged":
      return { label: ENGAGE_LABEL, percent: null };
    case "failed":
      return { label: `Sing-along unavailable: ${activity.reason ?? "unknown error"}`, percent: null };
  }
}

export { ASKING_LABEL, ENGAGE_LABEL, WAITING_LABEL, activityIsBusy, describeActivity, describeStage };
