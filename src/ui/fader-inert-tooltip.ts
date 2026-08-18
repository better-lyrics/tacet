import { describeAhead } from "@/orchestrator/ahead-status";
import type { StatusTrack } from "@/orchestrator/track-status";
import type { TooltipContent } from "@/ui/tooltip";

// -- What the fader says while sing-along is off -------------------------------

const SING_ALONG_OFF_LABEL = "Sing-along is off";
const CROSSFADE_ONLY_LABEL = "Sing-along is off, crossfade is still on";
const NEXT_TRACK_PREFIX = "Up next";

type AheadSnapshot = Pick<StatusTrack, "activity" | "cached" | "fraction">;

function aheadPercent(fraction: number | null): number | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  return Math.min(1, Math.max(0, fraction));
}

function describeInertFader(crossfadeSeconds: number, next: AheadSnapshot | null): TooltipContent {
  if (!(crossfadeSeconds > 0)) return { label: SING_ALONG_OFF_LABEL, percent: null };
  if (next === null) return { label: CROSSFADE_ONLY_LABEL, percent: null };

  const ahead = describeAhead(next.activity, null, next.cached);
  if (ahead === "") return { label: CROSSFADE_ONLY_LABEL, percent: null };

  return {
    label: `${NEXT_TRACK_PREFIX}: ${ahead}`,
    percent: aheadPercent(next.fraction),
    note: SING_ALONG_OFF_LABEL,
  };
}

export { describeInertFader, CROSSFADE_ONLY_LABEL, NEXT_TRACK_PREFIX, SING_ALONG_OFF_LABEL };
export type { AheadSnapshot };
