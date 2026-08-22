import { type SeparationMode, settlesEachTrack } from "@/settings/separation-mode";

// -- Does the fader settle when the listener moves to another track? -----------

interface TrackSettleInput {
  mode: SeparationMode;
  previousVideoId: string | null;
  videoId: string;
}

function settlesForTrackChange(input: TrackSettleInput): boolean {
  if (!settlesEachTrack(input.mode)) return false;
  if (input.previousVideoId === null || input.previousVideoId === "" || input.videoId === "") return false;
  return input.previousVideoId !== input.videoId;
}

export { settlesForTrackChange };
export type { TrackSettleInput };
