import type { KaraokeStatus } from "@/orchestrator/karaoke-state";
import { separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationMode } from "@/settings/separation-mode";
import type { TooltipContent } from "@/ui/tooltip";

// -- Which face the fader shows ------------------------------------------------

const ASKING_LABEL = "Click to separate this track";

type FaderFace = "inert" | "asking" | "karaoke-state";

interface FaderFaceInput {
  mode: SeparationMode;
  armed: boolean;
  status: KaraokeStatus | null;
}

function nothingDoneYet(status: KaraokeStatus | null): boolean {
  return status === null || status === "waiting-for-capture";
}

function faderFace(input: FaderFaceInput): FaderFace {
  const veto = separationVeto({ mode: input.mode, faderArmed: input.armed, role: "current" });
  if (veto === "sing-along-off") return "inert";
  if (veto === "nothing-asked-for-it" && nothingDoneYet(input.status)) return "asking";
  return "karaoke-state";
}

function describeAskingFader(): TooltipContent {
  return { label: ASKING_LABEL, percent: null };
}

export { ASKING_LABEL, describeAskingFader, faderFace };
export type { FaderFace, FaderFaceInput };
