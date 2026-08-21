import { type SeparationMode, separatesEveryTrack } from "@/settings/separation-mode";

// -- Does anything want this track separated? ---------------------------------

type SeparationVeto = "sing-along-off" | "nothing-asked-for-it";

interface SeparationWantedInput {
  mode: SeparationMode;
  faderArmed: boolean;
}

function separationVeto(input: SeparationWantedInput): SeparationVeto | null {
  if (input.mode === "off") return "sing-along-off";
  if (separatesEveryTrack(input.mode)) return null;
  return input.faderArmed ? null : "nothing-asked-for-it";
}

function describeSeparationVeto(veto: SeparationVeto): string {
  return veto === "sing-along-off" ? "sing-along is off" : "separation is off and the fader is neutral";
}

export { describeSeparationVeto, separationVeto };
export type { SeparationVeto, SeparationWantedInput };
