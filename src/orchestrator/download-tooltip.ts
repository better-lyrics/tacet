import { needsStarting } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";
import type { TooltipContent } from "@/ui/tooltip";

// -- What a source says about itself while it fetches --------------------------

const FETCHED_LABEL = "Downloading the track…";
const BUFFERED_LABEL = "Buffering with the player…";

function describeDownload(bufferedFraction: number, source: SourceId): TooltipContent {
  return {
    label: needsStarting(source) ? FETCHED_LABEL : BUFFERED_LABEL,
    percent: Number.isFinite(bufferedFraction) ? Math.min(1, Math.max(0, bufferedFraction)) : null,
  };
}

export { describeDownload, BUFFERED_LABEL, FETCHED_LABEL };
