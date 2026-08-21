// -- One separation mode, where there used to be two switches -------------------

type SeparationMode = "off" | "on-demand" | "every-track";

interface SeparationModeOption {
  value: SeparationMode;
  label: string;
  note: string;
}

const SEPARATION_MODES: readonly SeparationMode[] = ["off", "on-demand", "every-track"];

const SEPARATION_MODE_OPTIONS: readonly SeparationModeOption[] = [
  { value: "off", label: "Off", note: "The button stays on the page but does nothing." },
  {
    value: "on-demand",
    label: "Only when I ask",
    note: "Tap the button to separate the track you are on. Others are left alone.",
  },
  { value: "every-track", label: "Every track", note: "Separated ahead of time, so the button works instantly." },
];

function isSeparationMode(value: unknown): value is SeparationMode {
  return typeof value === "string" && SEPARATION_MODES.includes(value as SeparationMode);
}

// -- Migration from the two stored booleans -------------------------------------

function separationModeFromLegacy(singAlongEnabled: boolean, autoSeparateEnabled: boolean): SeparationMode {
  if (!singAlongEnabled) return "off";
  return autoSeparateEnabled ? "every-track" : "on-demand";
}

// -- What the mode says about the fader and the pipeline ------------------------

function settlesEachTrack(mode: SeparationMode): boolean {
  return mode === "on-demand";
}

function separatesEveryTrack(mode: SeparationMode): boolean {
  return mode === "every-track";
}

export {
  SEPARATION_MODES,
  SEPARATION_MODE_OPTIONS,
  isSeparationMode,
  separatesEveryTrack,
  separationModeFromLegacy,
  settlesEachTrack,
};
export type { SeparationMode, SeparationModeOption };
