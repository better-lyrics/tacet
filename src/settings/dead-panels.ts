import type { PopupTab } from "@/settings/popup-tabs";
import { type SeparationMode, separationIsOff } from "@/settings/separation-mode";

// -- Which panels does this configuration leave with nothing to do? --------------

interface DeadPanelInput {
  mode: SeparationMode;
  crossfadeSeconds: number;
}

const SEPARATION_DEAD_REASON = "Sing-along is off, so these do nothing.";
const SOURCES_DEAD_REASON = "Sing-along and crossfade are both off, so no track is fetched.";

function deadPanelReason(tab: PopupTab, input: DeadPanelInput): string | null {
  const separates = !separationIsOff(input.mode);
  const crossfades = input.crossfadeSeconds > 0;

  switch (tab) {
    case "separation":
      return separates ? null : SEPARATION_DEAD_REASON;
    case "sources":
      return separates || crossfades ? null : SOURCES_DEAD_REASON;
    case "general":
    case "storage":
      return null;
  }
}

export { deadPanelReason };
export type { DeadPanelInput };
