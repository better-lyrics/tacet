import { describe, expect, it } from "vitest";
import {
  SOURCES,
  SOURCE_IDS,
  isSourceId,
  nextSource,
  reaches,
  enabledOrder,
  sanitizeSourcePreferences,
  sourceById,
} from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";

const DEFAULT_ORDER = SOURCE_IDS;

describe("the source registry", () => {
  it("names every registered source exactly once", () => {
    expect(new Set(SOURCE_IDS).size).toBe(SOURCES.length);
  });

  it("answers for every id it publishes", () => {
    for (const id of SOURCE_IDS) expect(sourceById(id).id).toBe(id);
  });

  it("recognises its own ids and nothing else", () => {
    for (const id of SOURCE_IDS) expect(isSourceId(id)).toBe(true);
    expect(isSourceId("direct-download")).toBe(false);
    expect(isSourceId(null)).toBe(false);
    expect(isSourceId(0)).toBe(false);
  });
});

describe("reaches", () => {
  it("lets any source serve the track playing now", () => {
    for (const id of SOURCE_IDS) expect(reaches(id, true)).toBe(true);
  });

  it("keeps player capture off a track that is not playing", () => {
    expect(reaches("player-capture", false)).toBe(false);
    expect(reaches("hidden-player", false)).toBe(true);
    expect(reaches("direct-fetch", false)).toBe(true);
  });
});

describe("nextSource", () => {
  it("takes the first source in the listener's order", () => {
    expect(nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried: [] })).toBe("hidden-player");
  });

  it("moves down the order as rungs are tried", () => {
    expect(nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried: ["hidden-player"] })).toBe("player-capture");
    expect(nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried: ["hidden-player", "player-capture"] })).toBe(
      "direct-fetch"
    );
  });

  it("follows an order the listener rearranged", () => {
    const order: SourceId[] = ["hidden-player", "player-capture", "direct-fetch"];
    expect(nextSource({ order, playingTrack: true, tried: [] })).toBe("hidden-player");
    expect(nextSource({ order, playingTrack: true, tried: ["hidden-player"] })).toBe("player-capture");
  });

  describe("edge cases", () => {
    it("answers with nothing once every source has been tried", () => {
      expect(nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried: [...DEFAULT_ORDER] })).toBeNull();
    });

    it("answers with nothing for an empty order", () => {
      expect(nextSource({ order: [], playingTrack: true, tried: [] })).toBeNull();
    });

    it("skips a source that cannot reach the track", () => {
      expect(nextSource({ order: ["player-capture", "direct-fetch"], playingTrack: false, tried: [] })).toBe(
        "direct-fetch"
      );
    });

    it("answers with nothing when the only source left cannot reach the track", () => {
      expect(nextSource({ order: ["player-capture"], playingTrack: false, tried: [] })).toBeNull();
    });
  });

  describe("invariants", () => {
    it("never answers with a source already tried", () => {
      for (const tried of [[], ["direct-fetch"], ["direct-fetch", "player-capture"]] as SourceId[][]) {
        const answer = nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried });
        if (answer !== null) expect(tried).not.toContain(answer);
      }
    });

    it("walking the ladder to the end reaches every source that can reach the track", () => {
      const tried: SourceId[] = [];
      for (;;) {
        const answer = nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried });
        if (answer === null) break;
        tried.push(answer);
      }
      expect(tried).toEqual([...DEFAULT_ORDER]);
    });
  });
});

describe("sanitizeSourcePreferences", () => {
  const ids = (raw: unknown) => sanitizeSourcePreferences(raw).map(preference => preference.id);

  it("keeps the order the listener stated", () => {
    expect(
      ids([
        { id: "hidden-player", enabled: true },
        { id: "player-capture", enabled: true },
        { id: "direct-fetch", enabled: true },
      ])
    ).toEqual(["hidden-player", "player-capture", "direct-fetch"]);
  });

  it("carries enablement alongside the order", () => {
    expect(sanitizeSourcePreferences([{ id: "direct-fetch", enabled: false }])[0]).toEqual({
      id: "direct-fetch",
      enabled: false,
    });
  });

  describe("edge cases", () => {
    it("falls back to the registry order for anything unusable", () => {
      for (const raw of [undefined, null, "direct-fetch", {}]) {
        expect(ids(raw)).toEqual([...SOURCE_IDS]);
      }
    });

    it("drops names it does not recognise", () => {
      expect(ids(["torrent", { id: "player-capture" }, 7])).toEqual([
        "player-capture",
        "hidden-player",
        "direct-fetch",
      ]);
    });

    it("keeps the first mention of a repeated source", () => {
      expect(ids([{ id: "player-capture" }, { id: "player-capture" }, { id: "direct-fetch" }])).toEqual([
        "player-capture",
        "direct-fetch",
        "hidden-player",
      ]);
    });

    it("reads a bare list of ids, which is what was stored before enablement existed", () => {
      expect(sanitizeSourcePreferences(["direct-fetch", "hidden-player"])).toEqual([
        { id: "direct-fetch", enabled: true },
        { id: "hidden-player", enabled: true },
        { id: "player-capture", enabled: true },
      ]);
    });

    it("treats a missing enabled flag as on rather than off", () => {
      expect(sanitizeSourcePreferences([{ id: "direct-fetch" }])[0].enabled).toBe(true);
    });
  });

  describe("invariants", () => {
    it("always answers with every registered source, whatever it was given", () => {
      for (const raw of [undefined, [], ["direct-fetch"], ["nonsense"], [{ id: "player-capture", enabled: false }]]) {
        expect([...ids(raw)].sort()).toEqual([...SOURCE_IDS].sort());
      }
    });

    it("a source appended to fill a gap is never silently disabled", () => {
      const filled = sanitizeSourcePreferences([{ id: "direct-fetch", enabled: false }]);
      expect(filled.filter(preference => preference.id !== "direct-fetch").every(p => p.enabled)).toBe(true);
    });

    it("regression: an order naming one source still leaves the others to fall back on", () => {
      expect(sanitizeSourcePreferences(["direct-fetch"])).toHaveLength(SOURCE_IDS.length);
    });
  });
});

describe("enabledOrder", () => {
  it("keeps only what the listener left on, in their order", () => {
    expect(
      enabledOrder([
        { id: "direct-fetch", enabled: true },
        { id: "hidden-player", enabled: false },
        { id: "player-capture", enabled: true },
      ])
    ).toEqual(["direct-fetch", "player-capture"]);
  });

  describe("edge cases", () => {
    it("answers with nothing when every source is off", () => {
      expect(enabledOrder(SOURCE_IDS.map(id => ({ id, enabled: false })))).toEqual([]);
    });
  });

  describe("invariants", () => {
    it("never invents a source that was not in the preferences", () => {
      const order = enabledOrder([{ id: "direct-fetch", enabled: true }]);
      expect(order).toEqual(["direct-fetch"]);
    });
  });
});
