import { SOURCE_IDS, sanitizeSourcePreferences, sourceById } from "@/acquisition/sources";
import type { SourceId, SourcePreference } from "@/acquisition/sources";

// -- What a row in the sources list shows ----------------------------------------

interface SourceRow {
  id: SourceId;
  label: string;
  hint: string;
  enabled: boolean;
  position: number;
}

function sourceRows(preferences: readonly SourcePreference[]): SourceRow[] {
  return sanitizeSourcePreferences(preferences).map((preference, index) => ({
    id: preference.id,
    label: sourceById(preference.id).label,
    hint: sourceById(preference.id).hint,
    enabled: preference.enabled,
    position: index,
  }));
}

// -- What the listener can do to that list ----------------------------------------

function moveSource(preferences: readonly SourcePreference[], from: number, to: number): SourcePreference[] {
  const moved = sanitizeSourcePreferences(preferences);
  if (from < 0 || from >= moved.length || to < 0 || to >= moved.length || from === to) return moved;
  const [lifted] = moved.splice(from, 1);
  moved.splice(to, 0, lifted);
  return moved;
}

function toggleSource(preferences: readonly SourcePreference[], id: SourceId): SourcePreference[] {
  return sanitizeSourcePreferences(preferences).map(preference =>
    preference.id === id ? { ...preference, enabled: !preference.enabled } : preference
  );
}

// -- Whether that leaves anything able to acquire ---------------------------------

function acquisitionWarning(preferences: readonly SourcePreference[]): string | null {
  const enabled = sanitizeSourcePreferences(preferences).filter(preference => preference.enabled);
  if (enabled.length === 0) {
    return "Every source is off, so nothing will be separated until you turn one back on.";
  }
  if (enabled.every(preference => sourceById(preference.id).reach === "playing-track")) {
    return "Only the track playing now can be reached, so crossfades will not land on separated audio.";
  }
  return null;
}

export { SOURCE_IDS, acquisitionWarning, moveSource, sourceRows, toggleSource };
export type { SourceRow };
