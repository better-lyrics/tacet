// -- Arriving on a track a crossfade already faded into ----------------------

import type { StagedKind } from "@/automix/staged-source";
import type { KaraokeStatus } from "@/orchestrator/karaoke-state";

type LandingKind = StagedKind;

interface CrossfadeLandingInput {
  kind: LandingKind;
  status: KaraokeStatus;
  separating: boolean;
}

type CrossfadeLanding = "keep-deck" | "keep-deck-and-reacquire" | "release";

function decideCrossfadeLanding(input: CrossfadeLandingInput): CrossfadeLanding {
  if (input.kind === "mix") return input.separating ? "keep-deck-and-reacquire" : "keep-deck";
  if (!input.separating) return "keep-deck";
  return input.status === "engaged" ? "keep-deck" : "release";
}

export { decideCrossfadeLanding };
export type { CrossfadeLanding, CrossfadeLandingInput, LandingKind };
