import { type SeparationMode, separatesEveryTrack, separationIsOff } from "@/settings/separation-mode";

// -- Does anything want this track separated? ---------------------------------

type SeparationVeto = "sing-along-off" | "nothing-asked-for-it";

type SeparationRole = "current" | "ahead";

interface SeparationWantedInput {
  mode: SeparationMode;
  faderArmed: boolean;
  role: SeparationRole;
}

function separationVeto(input: SeparationWantedInput): SeparationVeto | null {
  if (separationIsOff(input.mode)) return "sing-along-off";
  if (separatesEveryTrack(input.mode)) return null;
  if (input.role === "ahead") return "nothing-asked-for-it";
  return input.faderArmed ? null : "nothing-asked-for-it";
}

function describeSeparationVeto(veto: SeparationVeto): string {
  return veto === "sing-along-off" ? "sing-along is off" : "separation is off and the fader is neutral";
}

export { describeSeparationVeto, separationVeto };
export type { SeparationRole, SeparationVeto, SeparationWantedInput };
