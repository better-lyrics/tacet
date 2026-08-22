// -- How far up the ladder a track has got ---------------------------------------

import { needsStarting, nextSource } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";

interface Climb {
  videoId: string;
  tried: SourceId[];
  inFlight: boolean;
  exhausted: boolean;
}

function startClimb(videoId: string): Climb {
  return { videoId, tried: [], inFlight: false, exhausted: false };
}

// -- The one step a climb may take -----------------------------------------------

interface ClimbInput {
  climb: Climb;
  order: readonly SourceId[];
  playingTrack: boolean;
}

type ClimbStep =
  | { kind: "waiting" }
  | { kind: "start"; source: SourceId; tried: SourceId[]; passedOver: SourceId[] }
  | { kind: "spent"; tried: SourceId[]; passedOver: SourceId[] };

function climbStep(input: ClimbInput): ClimbStep {
  if (input.climb.inFlight || input.climb.exhausted) return { kind: "waiting" };

  const tried = [...input.climb.tried];
  const passedOver: SourceId[] = [];

  for (;;) {
    const source = nextSource({ order: input.order, playingTrack: input.playingTrack, tried });
    if (source === null) return { kind: "spent", tried, passedOver };
    tried.push(source);
    if (!needsStarting(source)) {
      passedOver.push(source);
      continue;
    }
    return { kind: "start", source, tried, passedOver };
  }
}

export { climbStep, startClimb };
export type { Climb, ClimbInput, ClimbStep };
