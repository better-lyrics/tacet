// -- Does anything want this track separated? ---------------------------------

interface SeparationWantedInput {
  singAlongEnabled: boolean;
  autoSeparateEnabled: boolean;
  faderArmed: boolean;
}

function separationWanted(input: SeparationWantedInput): boolean {
  if (!input.singAlongEnabled) return false;
  return input.autoSeparateEnabled || input.faderArmed;
}

export { separationWanted };
export type { SeparationWantedInput };
