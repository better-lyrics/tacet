// -- Arriving on a track a crossfade already faded into ----------------------

import type { StagedKind } from "@/automix/staged-source";
import type { KaraokeStatus } from "@/orchestrator/karaoke-state";

type LandingKind = StagedKind;

interface CrossfadeLandingInput {
  kind: LandingKind;
  status: KaraokeStatus;
}

type CrossfadeLanding = "keep-deck" | "keep-deck-and-reacquire" | "release";

function decideCrossfadeLanding(input: CrossfadeLandingInput): CrossfadeLanding {
  if (input.status !== "engaged") return "release";
  return input.kind === "stems" ? "keep-deck" : "keep-deck-and-reacquire";
}

export { decideCrossfadeLanding };
export type { CrossfadeLanding, CrossfadeLandingInput, LandingKind };
