// -- What a source is ----------------------------------------------------------

type SourceId = "shadow-url" | "hidden-player" | "player-capture";

type SourceReach = "playing-track" | "any-track";

type SourceStart = "on-request" | "already-running";

type SourceSpeedRank = 1 | 2 | 3 | 4;

interface SourceSpeed {
  rank: SourceSpeedRank;
  hint: string;
}

interface SourceDefinition {
  id: SourceId;
  label: string;
  hint: string;
  reach: SourceReach;
  start: SourceStart;
  speed: SourceSpeed;
}

// -- The registry, in the order it is tried by default --------------------------

const SOURCES: readonly SourceDefinition[] = [
  {
    id: "shadow-url",
    label: "Shadow player",
    hint: "Gets a link from this page, then downloads it. Any track.",
    reach: "any-track",
    start: "on-request",
    speed: { rank: 4, hint: "A few seconds a track" },
  },
  {
    id: "hidden-player",
    label: "Hidden player",
    hint: "Loads the track in a background player. Any track.",
    reach: "any-track",
    start: "on-request",
    speed: { rank: 3, hint: "About ten seconds a track" },
  },
  {
    id: "player-capture",
    label: "Player capture",
    hint: "Copies whatever you play as it streams. Current track only.",
    reach: "playing-track",
    start: "already-running",
    speed: { rank: 1, hint: "As slow as the track is long" },
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

function needsStarting(id: SourceId): boolean {
  return sourceById(id).start === "on-request";
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

export {
  SOURCES,
  SOURCE_IDS,
  enabledOrder,
  isSourceId,
  needsStarting,
  nextSource,
  reaches,
  sanitizeSourcePreferences,
  sourceById,
};
export type {
  LadderInput,
  SourceId,
  SourceDefinition,
  SourcePreference,
  SourceReach,
  SourceSpeed,
  SourceSpeedRank,
  SourceStart,
};
