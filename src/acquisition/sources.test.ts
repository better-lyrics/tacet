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
    expect(reaches("shadow-url", false)).toBe(true);
    expect(reaches("hidden-player", false)).toBe(true);
  });
});

describe("nextSource", () => {
  it("takes the first source in the listener's order", () => {
    expect(nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried: [] })).toBe("shadow-url");
  });

  it("moves down the order as rungs are tried", () => {
    expect(nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried: ["shadow-url"] })).toBe("hidden-player");
    expect(nextSource({ order: DEFAULT_ORDER, playingTrack: true, tried: ["shadow-url", "hidden-player"] })).toBe(
      "player-capture"
    );
  });

  it("follows an order the listener rearranged", () => {
    const order: SourceId[] = ["hidden-player", "player-capture", "shadow-url"];
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
      expect(nextSource({ order: ["player-capture", "shadow-url"], playingTrack: false, tried: [] })).toBe(
        "shadow-url"
      );
    });

    it("answers with nothing when the only source left cannot reach the track", () => {
      expect(nextSource({ order: ["player-capture"], playingTrack: false, tried: [] })).toBeNull();
    });
  });

  describe("invariants", () => {
    it("never answers with a source already tried", () => {
      for (const tried of [[], ["shadow-url"], ["shadow-url", "player-capture"]] as SourceId[][]) {
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
        { id: "shadow-url", enabled: true },
      ])
    ).toEqual(["hidden-player", "player-capture", "shadow-url"]);
  });

  it("carries enablement alongside the order", () => {
    expect(sanitizeSourcePreferences([{ id: "shadow-url", enabled: false }])[0]).toEqual({
      id: "shadow-url",
      enabled: false,
    });
  });

  describe("edge cases", () => {
    it("falls back to the registry order for anything unusable", () => {
      for (const raw of [undefined, null, "shadow-url", {}]) {
        expect(ids(raw)).toEqual([...SOURCE_IDS]);
      }
    });

    it("drops names it does not recognise", () => {
      expect(ids(["torrent", { id: "player-capture" }, 7])).toEqual(["player-capture", "shadow-url", "hidden-player"]);
    });

    it("keeps the first mention of a repeated source", () => {
      expect(ids([{ id: "player-capture" }, { id: "player-capture" }, { id: "shadow-url" }])).toEqual([
        "player-capture",
        "shadow-url",
        "hidden-player",
      ]);
    });

    it("reads a bare list of ids, which is what was stored before enablement existed", () => {
      expect(sanitizeSourcePreferences(["shadow-url", "hidden-player"])).toEqual([
        { id: "shadow-url", enabled: true },
        { id: "hidden-player", enabled: true },
        { id: "player-capture", enabled: true },
      ]);
    });

    it("treats a missing enabled flag as on rather than off", () => {
      expect(sanitizeSourcePreferences([{ id: "shadow-url" }])[0].enabled).toBe(true);
    });
  });

  describe("invariants", () => {
    it("always answers with every registered source, whatever it was given", () => {
      for (const raw of [undefined, [], ["shadow-url"], ["nonsense"], [{ id: "player-capture", enabled: false }]]) {
        expect([...ids(raw)].sort()).toEqual([...SOURCE_IDS].sort());
      }
    });

    it("a source appended to fill a gap is never silently disabled", () => {
      const filled = sanitizeSourcePreferences([{ id: "shadow-url", enabled: false }]);
      expect(filled.filter(preference => preference.id !== "shadow-url").every(p => p.enabled)).toBe(true);
    });

    it("regression: an order naming one source still leaves the others to fall back on", () => {
      expect(sanitizeSourcePreferences(["shadow-url"])).toHaveLength(SOURCE_IDS.length);
    });
  });
});

describe("enabledOrder", () => {
  it("keeps only what the listener left on, in their order", () => {
    expect(
      enabledOrder([
        { id: "shadow-url", enabled: true },
        { id: "hidden-player", enabled: false },
        { id: "player-capture", enabled: true },
      ])
    ).toEqual(["shadow-url", "player-capture"]);
  });

  describe("edge cases", () => {
    it("answers with nothing when every source is off", () => {
      expect(enabledOrder(SOURCE_IDS.map(id => ({ id, enabled: false })))).toEqual([]);
    });
  });

  describe("invariants", () => {
    it("never invents a source that was not in the preferences", () => {
      const order = enabledOrder([{ id: "shadow-url", enabled: true }]);
      expect(order).toEqual(["shadow-url"]);
    });
  });
});
