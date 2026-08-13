// -- What a source is ----------------------------------------------------------

type SourceId = "shadow-url" | "hidden-player" | "player-capture" | "direct-fetch";

type SourceReach = "playing-track" | "any-track";

interface SourceDefinition {
  id: SourceId;
  label: string;
  hint: string;
  reach: SourceReach;
}

// -- The registry, in the order it is tried by default --------------------------

const SOURCES: readonly SourceDefinition[] = [
  {
    id: "shadow-url",
    label: "Shadow player",
    hint: "Asks this page for a download link, then fetches the track itself. Any track, and the fastest.",
    reach: "any-track",
  },
  // Player capture sits above the hidden player deliberately. The shadow stands
  // down for 30 minutes after two unattested mints, and when it does, the free
  // source should cover the track playing now before a frame is spawned and costs
  // the tab 35 MB it never gets back. The hidden player still covers the track
  // that is coming next, which player capture cannot reach at all.
  {
    id: "player-capture",
    label: "Player capture",
    hint: "Copies what your player is already streaming. Free, and only the track playing now.",
    reach: "playing-track",
  },
  {
    id: "hidden-player",
    label: "Hidden player",
    hint: "A second player streams an upcoming track. Any track, and costs memory for the tab.",
    reach: "any-track",
  },
  {
    id: "direct-fetch",
    label: "Direct fetch",
    hint: "Asks your player for a link, then downloads the track itself. Fastest, when it is allowed.",
    reach: "any-track",
  },
];

const SOURCE_IDS: readonly SourceId[] = SOURCES.map(source => source.id);

function isSourceId(value: unknown): value is SourceId {
  return typeof value === "string" && (SOURCE_IDS as readonly string[]).includes(value);
}

function sourceById(id: SourceId): SourceDefinition {
  const found = SOURCES.find(source => source.id === id);
  if (!found) throw new Error(`no source is registered as ${id}`);
  return found;
}

function reaches(id: SourceId, playingTrack: boolean): boolean {
  return playingTrack || sourceById(id).reach === "any-track";
}

// -- What the listener asked for, which is one value ------------------------------

interface SourcePreference {
  id: SourceId;
  enabled: boolean;
}

function readPreference(raw: unknown): SourcePreference | null {
  if (isSourceId(raw)) return { id: raw, enabled: true };
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (!isSourceId(record.id)) return null;
  return { id: record.id, enabled: record.enabled !== false };
}

function sanitizeSourcePreferences(raw: unknown): SourcePreference[] {
  const preferences: SourcePreference[] = [];
  const seen = new Set<SourceId>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const preference = readPreference(entry);
    if (!preference || seen.has(preference.id)) continue;
    seen.add(preference.id);
    preferences.push(preference);
  }
  for (const id of SOURCE_IDS) {
    if (seen.has(id)) continue;
    preferences.push({ id, enabled: true });
  }
  return preferences;
}

function enabledOrder(preferences: readonly SourcePreference[]): SourceId[] {
  return preferences.filter(preference => preference.enabled).map(preference => preference.id);
}

// -- The ladder ------------------------------------------------------------------

interface LadderInput {
  order: readonly SourceId[];
  playingTrack: boolean;
  tried: readonly SourceId[];
}

function nextSource(input: LadderInput): SourceId | null {
  for (const id of input.order) {
    if (input.tried.includes(id)) continue;
    if (!reaches(id, input.playingTrack)) continue;
    return id;
  }
  return null;
}

export { SOURCES, SOURCE_IDS, enabledOrder, isSourceId, nextSource, reaches, sanitizeSourcePreferences, sourceById };
export type { LadderInput, SourceId, SourceDefinition, SourcePreference, SourceReach };
