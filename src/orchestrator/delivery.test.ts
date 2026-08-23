import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/acquisition/sources";
import {
  DELIVERY_LOG_CAPACITY,
  DeliveryLog,
  deliveredBy,
  describeDelivery,
  describeNowArtist,
} from "@/orchestrator/delivery";

describe("deliveredBy", () => {
  it("credits the source that announced a url", () => {
    expect(deliveredBy({ known: null, inFlightSource: "hidden-player", announcedSource: "hidden-player" })).toBe(
      "hidden-player"
    );
  });

  it("credits the rung that was running when bytes arrived without an announcement", () => {
    expect(deliveredBy({ known: null, inFlightSource: "hidden-player", announcedSource: null })).toBe("hidden-player");
  });

  it("credits the listener's own playback when no rung was running and nothing was recorded", () => {
    expect(deliveredBy({ known: null, inFlightSource: null, announcedSource: null })).toBe("player-capture");
  });

  it("keeps the recorded source when neither an announcement nor a running rung is known", () => {
    expect(deliveredBy({ known: "shadow-url", inFlightSource: null, announcedSource: null })).toBe("shadow-url");
  });

  describe("edge cases", () => {
    it("lets an announcement overrule what was already recorded", () => {
      expect(deliveredBy({ known: "shadow-url", inFlightSource: null, announcedSource: "hidden-player" })).toBe(
        "hidden-player"
      );
    });

    it("lets the running rung overrule what was already recorded", () => {
      expect(deliveredBy({ known: "shadow-url", inFlightSource: "hidden-player", announcedSource: null })).toBe(
        "hidden-player"
      );
    });
  });

  describe("invariants", () => {
    it("always names a registered source", () => {
      for (const known of [null, ...SOURCE_IDS]) {
        for (const inFlightSource of [null, ...SOURCE_IDS]) {
          for (const announcedSource of [null, ...SOURCE_IDS]) {
            expect(SOURCE_IDS).toContain(deliveredBy({ known, inFlightSource, announcedSource }));
          }
        }
      }
    });

    it("prefers the announcement over the rung whenever both are known", () => {
      for (const announcedSource of SOURCE_IDS) {
        expect(deliveredBy({ known: "shadow-url", inFlightSource: "hidden-player", announcedSource })).toBe(
          announcedSource
        );
      }
    });

    it("prefers the running rung over what was already recorded whenever nothing was announced", () => {
      for (const inFlightSource of SOURCE_IDS) {
        expect(deliveredBy({ known: "shadow-url", inFlightSource, announcedSource: null })).toBe(inFlightSource);
      }
    });
  });
});

describe("DeliveryLog", () => {
  it("reads back the source a track was noted with", () => {
    const log = new DeliveryLog();
    log.note("aaa", { inFlightSource: null, announcedSource: "shadow-url" });
    expect(log.sourceOf("aaa")).toBe("shadow-url");
  });

  it("keeps two tracks apart", () => {
    const log = new DeliveryLog();
    log.note("aaa", { inFlightSource: null, announcedSource: "shadow-url" });
    log.note("bbb", { inFlightSource: "hidden-player", announcedSource: null });
    expect(log.sourceOf("aaa")).toBe("shadow-url");
    expect(log.sourceOf("bbb")).toBe("hidden-player");
  });

  describe("edge cases", () => {
    it("answers with nothing for a track it has never been told about", () => {
      expect(new DeliveryLog().sourceOf("aaa")).toBeNull();
    });

    it("leaves the first answer alone when a later note knows nothing", () => {
      const log = new DeliveryLog();
      log.note("aaa", { inFlightSource: null, announcedSource: "hidden-player" });
      log.note("aaa", { inFlightSource: null, announcedSource: null });
      expect(log.sourceOf("aaa")).toBe("hidden-player");
    });

    it("replaces the first answer when a later note announces a source", () => {
      const log = new DeliveryLog();
      log.note("aaa", { inFlightSource: null, announcedSource: "hidden-player" });
      log.note("aaa", { inFlightSource: null, announcedSource: "shadow-url" });
      expect(log.sourceOf("aaa")).toBe("shadow-url");
    });

    it("answers with nothing after being cleared", () => {
      const log = new DeliveryLog();
      log.note("aaa", { inFlightSource: null, announcedSource: "shadow-url" });
      log.clear();
      expect(log.sourceOf("aaa")).toBeNull();
    });
  });

  describe("invariants", () => {
    it("never remembers more tracks than its capacity", () => {
      const log = new DeliveryLog();
      for (let index = 0; index < DELIVERY_LOG_CAPACITY * 4; index += 1) {
        log.note(`track-${index}`, { inFlightSource: null, announcedSource: "shadow-url" });
      }
      const remembered = Array.from({ length: DELIVERY_LOG_CAPACITY * 4 }, (_unused, index) =>
        log.sourceOf(`track-${index}`)
      ).filter(source => source !== null);
      expect(remembered).toHaveLength(DELIVERY_LOG_CAPACITY);
    });

    it("evicts the track written longest ago rather than the one written most recently", () => {
      const log = new DeliveryLog();
      for (let index = 0; index < DELIVERY_LOG_CAPACITY; index += 1) {
        log.note(`track-${index}`, { inFlightSource: null, announcedSource: "shadow-url" });
      }
      log.note("track-0", { inFlightSource: null, announcedSource: "hidden-player" });
      log.note("newcomer", { inFlightSource: null, announcedSource: "shadow-url" });

      expect(log.sourceOf("track-0")).toBe("hidden-player");
      expect(log.sourceOf("track-1")).toBeNull();
      expect(log.sourceOf("newcomer")).toBe("shadow-url");
    });
  });

  describe("regressions", () => {
    it("regression: a track fetched by the shadow player is not relabelled player capture when the listener's own player finishes buffering it", () => {
      const log = new DeliveryLog();
      log.note("aaa", { inFlightSource: "shadow-url", announcedSource: "shadow-url" });
      log.note("aaa", { inFlightSource: null, announcedSource: null });
      expect(log.sourceOf("aaa")).toBe("shadow-url");
    });

    it("regression: the ladder may still correct itself when a rung is refused", () => {
      const log = new DeliveryLog();
      log.note("aaa", { inFlightSource: null, announcedSource: "shadow-url" });
      log.note("aaa", { inFlightSource: null, announcedSource: "hidden-player" });
      expect(log.sourceOf("aaa")).toBe("hidden-player");
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
