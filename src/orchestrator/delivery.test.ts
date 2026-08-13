import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/acquisition/sources";
import { deliveredBy, describeDelivery, describeNowArtist } from "@/orchestrator/delivery";

describe("deliveredBy", () => {
  it("credits the source that announced a url", () => {
    expect(deliveredBy({ inFlightSource: "hidden-player", announcedSource: "hidden-player" })).toBe("hidden-player");
  });

  it("credits the rung that was running when bytes arrived without an announcement", () => {
    expect(deliveredBy({ inFlightSource: "hidden-player", announcedSource: null })).toBe("hidden-player");
  });

  it("credits the listener's own playback when no rung was running", () => {
    expect(deliveredBy({ inFlightSource: null, announcedSource: null })).toBe("player-capture");
  });

  describe("invariants", () => {
    it("always names a registered source", () => {
      for (const inFlightSource of [null, ...SOURCE_IDS]) {
        for (const announcedSource of [null, ...SOURCE_IDS]) {
          expect(SOURCE_IDS).toContain(deliveredBy({ inFlightSource, announcedSource }));
        }
      }
    });

    it("prefers the announcement over the rung whenever both are known", () => {
      for (const announcedSource of SOURCE_IDS) {
        expect(deliveredBy({ inFlightSource: "hidden-player", announcedSource })).toBe(announcedSource);
      }
    });
  });
});

describe("describeNowArtist", () => {
  it("puts the source after the artist", () => {
    expect(describeNowArtist("Some Artist", "Shadow player")).toBe("Some Artist · via Shadow player");
  });

  describe("edge cases", () => {
    it("shows the artist alone when no source has delivered", () => {
      expect(describeNowArtist("Some Artist", null)).toBe("Some Artist");
    });

    it("shows the source alone rather than a leading separator when the artist is unknown", () => {
      expect(describeNowArtist("", "Hidden player")).toBe("via Hidden player");
      expect(describeNowArtist("   ", "Hidden player")).toBe("via Hidden player");
    });

    it("answers with nothing at all when neither is known", () => {
      expect(describeNowArtist("", null)).toBe("");
    });
  });

  describe("invariants", () => {
    it("never leaves a dangling separator", () => {
      for (const artist of ["", "  ", "Artist"]) {
        for (const delivery of [null, "Shadow player"]) {
          const line = describeNowArtist(artist, delivery);
          expect(line.startsWith("·")).toBe(false);
          expect(line.endsWith("·")).toBe(false);
        }
      }
    });
  });
});

describe("describeDelivery", () => {
  it("answers with the registry's own label rather than the id", () => {
    expect(describeDelivery("hidden-player")).toBe("Hidden player");
  });

  describe("edge cases", () => {
    it("answers with nothing when no source has delivered yet", () => {
      expect(describeDelivery(null)).toBeNull();
    });
  });
});
