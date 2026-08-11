import { settledTrackDuration } from "@/capture/settled-duration";

type GraphPresence = "none" | "bound";

type TargetPosition = "none" | "same" | "other";

interface EngagementInput {
  hasStems: boolean;
  graph: GraphPresence;
  boundElementConnected: boolean;
  target: TargetPosition;
  acquiring: boolean;
  stemsEngaged: boolean;
  stemsAudible: boolean;
  adPlaying: boolean;
  stemsAreStale: boolean;
}

type EngagementAction = "idle" | "hold" | "rebind" | "engage" | "load" | "release" | "suspend" | "resume";

function decideEngagement(input: EngagementInput): EngagementAction {
  if (!input.hasStems) return "idle";

  if (input.graph === "bound") {
    if (!input.boundElementConnected) return "rebind";
    if (input.adPlaying) return input.stemsAudible ? "suspend" : "hold";
    if (input.stemsAreStale) return "release";
    if (input.target === "other") return "rebind";
    if (input.target === "none") return "hold";
    if (!input.stemsEngaged) return "load";
    return input.stemsAudible ? "hold" : "resume";
  }

  if (input.adPlaying || input.target === "none" || input.acquiring) return "hold";
  return "engage";
}

// -- Recovering from an emptied element --------------------------------------

type Reconfirmation = "confirmed" | "unconfirmed";

interface ReconfirmInput {
  playerVideoId: string | null;
  stemsVideoId: string;
  elementDurationSeconds: number;
  clockDurationSeconds: number;
}

function reconfirmAfterEmptied(input: ReconfirmInput): Reconfirmation {
  if (input.playerVideoId === null || input.playerVideoId !== input.stemsVideoId) return "unconfirmed";
  if (!Number.isFinite(input.clockDurationSeconds) || input.clockDurationSeconds <= 0) return "unconfirmed";
  return settledTrackDuration(input.elementDurationSeconds, input.clockDurationSeconds) === null
    ? "unconfirmed"
    : "confirmed";
}

export { decideEngagement, reconfirmAfterEmptied };
export type { EngagementAction, EngagementInput, GraphPresence, TargetPosition, Reconfirmation, ReconfirmInput };
