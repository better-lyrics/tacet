import { type SeparationMode, separatesEveryTrack } from "@/settings/separation-mode";

// -- Does anything want the next track's bytes? ---------------------------------

interface AheadWantedInput {
  mode: SeparationMode;
  crossfadeSeconds: number;
}

function wantsAheadTrack(input: AheadWantedInput): boolean {
  if (Number.isFinite(input.crossfadeSeconds) && input.crossfadeSeconds > 0) return true;
  return separatesEveryTrack(input.mode);
}

export { wantsAheadTrack };
export type { AheadWantedInput };
