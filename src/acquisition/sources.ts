// -- What a source is ----------------------------------------------------------

type SourceId = "hidden-player" | "player-capture" | "direct-fetch";

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
    id: "hidden-player",
    label: "Hidden player",
    hint: "A second player streams an upcoming track. Any track, and costs memory for the tab.",
    reach: "any-track",
  },
  {
    id: "player-capture",
    label: "Player capture",
    hint: "Copies what your player is already streaming. Free, and only the track playing now.",
    reach: "playing-track",
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

// -- The order the listener asked for --------------------------------------------

function sanitizeSourceOrder(raw: unknown): SourceId[] {
  const named = Array.isArray(raw) ? raw.filter(isSourceId) : [];
  const order: SourceId[] = [];
  for (const id of [...named, ...SOURCE_IDS]) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
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

export { SOURCES, SOURCE_IDS, isSourceId, nextSource, reaches, sanitizeSourceOrder, sourceById };
export type { LadderInput, SourceId, SourceDefinition, SourceReach };
