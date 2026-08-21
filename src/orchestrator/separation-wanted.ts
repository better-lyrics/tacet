// -- Does anything want this track separated? ---------------------------------

type SeparationVeto = "sing-along-off" | "nothing-asked-for-it";

interface SeparationWantedInput {
  singAlongEnabled: boolean;
  autoSeparateEnabled: boolean;
  faderArmed: boolean;
}

function separationVeto(input: SeparationWantedInput): SeparationVeto | null {
  if (!input.singAlongEnabled) return "sing-along-off";
  return input.autoSeparateEnabled || input.faderArmed ? null : "nothing-asked-for-it";
}

function describeSeparationVeto(veto: SeparationVeto): string {
  return veto === "sing-along-off" ? "sing-along is off" : "separation is off and the fader is neutral";
}

export { describeSeparationVeto, separationVeto };
export type { SeparationVeto, SeparationWantedInput };
