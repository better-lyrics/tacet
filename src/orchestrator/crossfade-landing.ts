// -- Arriving on a track a crossfade already faded into ----------------------

import type { KaraokeStatus } from "@/orchestrator/karaoke-state";

type LandingKind = "stems" | "mix";

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
