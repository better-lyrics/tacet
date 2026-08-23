import type { SourceId } from "@/acquisition/sources";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationMode } from "@/settings/separation-mode";

// -- What this track's separation is doing right now ---------------------------

interface SeparationWork {
  stage: string | null;
  processed: number;
  total: number;
}

type SeparationActivity =
  | { kind: "off" }
  | { kind: "asking" }
  | { kind: "waiting" }
  | { kind: "downloading"; source: SourceId; fraction: number }
  | ({ kind: "working" } & SeparationWork)
  | { kind: "ready-to-engage" }
  | { kind: "engaged" }
  | { kind: "failed"; reason: string | null };

interface SeparationActivityInput {
  mode: SeparationMode;
  armed: boolean;
  state: KaraokeState | null;
}

function nothingDoneYet(state: KaraokeState | null): boolean {
  return state === null || state.status === "waiting-for-capture";
}

function fromState(state: KaraokeState | null): SeparationActivity {
  if (state === null) return { kind: "waiting" };

  switch (state.status) {
    case "waiting-for-capture":
      return state.downloadSource === null
        ? { kind: "waiting" }
        : { kind: "downloading", source: state.downloadSource, fraction: state.downloadFraction };
    case "ready-to-engage":
      return { kind: "ready-to-engage" };
    case "processing":
      return { kind: "working", stage: state.stage, processed: state.processed, total: state.total };
    case "engaged":
      return { kind: "engaged" };
    case "failed":
      return { kind: "failed", reason: state.reason };
  }
}

function separationActivity(input: SeparationActivityInput): SeparationActivity {
  const veto = separationVeto({ mode: input.mode, faderArmed: input.armed, role: "current" });
  if (veto === "sing-along-off") return { kind: "off" };
  if (veto === "nothing-asked-for-it" && nothingDoneYet(input.state)) return { kind: "asking" };
  return fromState(input.state);
}

export { separationActivity };
export type { SeparationActivity, SeparationActivityInput, SeparationWork };
