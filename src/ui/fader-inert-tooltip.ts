import type { TooltipContent } from "@/ui/tooltip";

// -- What the fader says while sing-along is off -------------------------------

const SING_ALONG_OFF_LABEL = "Sing-along is off";
const CROSSFADE_ONLY_LABEL = "Sing-along is off, crossfade is still on";

function describeInertFader(crossfadeSeconds: number): TooltipContent {
  return { label: crossfadeSeconds > 0 ? CROSSFADE_ONLY_LABEL : SING_ALONG_OFF_LABEL, percent: null };
}

export { describeInertFader, CROSSFADE_ONLY_LABEL, SING_ALONG_OFF_LABEL };
