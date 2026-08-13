import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/acquisition/sources";
import type { SourcePreference } from "@/acquisition/sources";
import { acquisitionWarning, moveSource, sourceRows, toggleSource } from "@/settings/source-rows";

const ALL_ON: SourcePreference[] = [
  { id: "shadow-url", enabled: true },
  { id: "hidden-player", enabled: true },
  { id: "player-capture", enabled: true },
  { id: "direct-fetch", enabled: true },
];

const ids = (preferences: readonly SourcePreference[]) => preferences.map(preference => preference.id);

describe("sourceRows", () => {
  it("describes every source in the listener's order", () => {
    const rows = sourceRows(ALL_ON);
    expect(rows.map(row => row.id)).toEqual(["shadow-url", "hidden-player", "player-capture", "direct-fetch"]);
    expect(rows.map(row => row.position)).toEqual([0, 1, 2, 3]);
  });

  it("carries the registry's own label and hint rather than inventing copy", () => {
    const row = sourceRows(ALL_ON)[0];
    expect(row.label.length).toBeGreaterThan(0);
    expect(row.hint.length).toBeGreaterThan(0);
  });

  describe("edge cases", () => {
    it("describes every source even when storage held nothing", () => {
      expect(
        sourceRows([])
          .map(row => row.id)
          .sort()
      ).toEqual([...SOURCE_IDS].sort());
    });

    it("shows a disabled source rather than hiding it", () => {
      const rows = sourceRows([{ id: "direct-fetch", enabled: false }]);
      expect(rows.find(row => row.id === "direct-fetch")?.enabled).toBe(false);
      expect(rows).toHaveLength(SOURCE_IDS.length);
    });
  });
});

describe("moveSource", () => {
  it("lifts a source out and drops it at the new index", () => {
    expect(ids(moveSource(ALL_ON, 2, 0))).toEqual(["player-capture", "shadow-url", "hidden-player", "direct-fetch"]);
  });

  it("moves a source down as well as up", () => {
    expect(ids(moveSource(ALL_ON, 0, 2))).toEqual(["hidden-player", "player-capture", "shadow-url", "direct-fetch"]);
  });

  describe("edge cases", () => {
    it("does nothing when the source did not move", () => {
      expect(ids(moveSource(ALL_ON, 1, 1))).toEqual(ids(ALL_ON));
    });

    it("refuses an index outside the list rather than dropping a source", () => {
      for (const [from, to] of [
        [-1, 0],
        [0, -1],
        [4, 0],
        [0, 4],
      ]) {
        expect(ids(moveSource(ALL_ON, from, to))).toEqual(ids(ALL_ON));
      }
    });
  });

  describe("invariants", () => {
    it("never loses or duplicates a source, whatever it is asked", () => {
      for (let from = -1; from <= 4; from++) {
        for (let to = -1; to <= 4; to++) {
          expect([...ids(moveSource(ALL_ON, from, to))].sort()).toEqual([...SOURCE_IDS].sort());
        }
      }
    });

    it("carries enablement with the source it belongs to", () => {
      const withOff: SourcePreference[] = [
        { id: "hidden-player", enabled: true },
        { id: "player-capture", enabled: false },
        { id: "direct-fetch", enabled: true },
      ];
      const moved = moveSource(withOff, 1, 0);
      expect(moved[0]).toEqual({ id: "player-capture", enabled: false });
    });
  });
});

describe("toggleSource", () => {
  it("turns a source off and back on", () => {
    const off = toggleSource(ALL_ON, "direct-fetch");
    expect(off.find(preference => preference.id === "direct-fetch")?.enabled).toBe(false);
    expect(toggleSource(off, "direct-fetch").find(p => p.id === "direct-fetch")?.enabled).toBe(true);
  });

  describe("invariants", () => {
    it("leaves the order alone", () => {
      expect(ids(toggleSource(ALL_ON, "hidden-player"))).toEqual(ids(ALL_ON));
    });

    it("touches only the source named", () => {
      const toggled = toggleSource(ALL_ON, "hidden-player");
      expect(toggled.filter(p => p.id !== "hidden-player").every(p => p.enabled)).toBe(true);
    });
  });
});

describe("acquisitionWarning", () => {
  it("says nothing while a source can reach an upcoming track", () => {
    expect(acquisitionWarning(ALL_ON)).toBeNull();
  });

  describe("edge cases", () => {
    it("warns when every source is off", () => {
      expect(acquisitionWarning(SOURCE_IDS.map(id => ({ id, enabled: false })))).toContain("Every source is off");
    });

    it("warns when only the playing track can be reached", () => {
      const warning = acquisitionWarning([
        { id: "player-capture", enabled: true },
        { id: "shadow-url", enabled: false },
        { id: "hidden-player", enabled: false },
        { id: "direct-fetch", enabled: false },
      ]);
      expect(warning).toContain("track playing now");
    });
  });

  describe("regressions", () => {
    it("does not warn merely because the passive source sits first", () => {
      expect(
        acquisitionWarning([
          { id: "player-capture", enabled: true },
          { id: "hidden-player", enabled: true },
          { id: "direct-fetch", enabled: true },
        ])
      ).toBeNull();
    });
  });
});
