import { createComingUpStore } from "@/orchestrator/coming-up";
import { describe, expect, it } from "vitest";

const TRACK = { videoId: "abc", title: "Nightcall", artist: "Kavinsky" };
const OTHER = { videoId: "xyz", title: "Weightless", artist: "Marconi Union" };

describe("coming up store", () => {
  describe("happy path", () => {
    it("starts empty", () => {
      expect(createComingUpStore().get()).toBeNull();
    });

    it("holds the track it is given", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      expect(store.get()).toEqual({ ...TRACK, artworkUrl: null, cached: null });
    });

    it("takes artwork and cache state for that track", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.setArtwork("abc", "https://i.ytimg.com/vi/abc/maxresdefault.jpg");
      store.setCached("abc", true);
      expect(store.get()).toEqual({
        ...TRACK,
        artworkUrl: "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
        cached: true,
      });
    });
  });

  describe("edge cases", () => {
    it("ignores artwork and cache state before any track is known", () => {
      const store = createComingUpStore();
      store.setArtwork("abc", "art");
      store.setCached("abc", true);
      expect(store.get()).toBeNull();
    });

    it("clears", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.clear();
      expect(store.get()).toBeNull();
    });

    it("keeps a null title rather than inventing one", () => {
      const store = createComingUpStore();
      store.setTrack({ videoId: "abc", title: null, artist: null });
      expect(store.get()).toMatchObject({ title: null, artist: null });
    });
  });

  describe("invariants", () => {
    it("a new track drops the previous artwork and cache state", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.setArtwork("abc", "art");
      store.setCached("abc", true);
      store.setTrack(OTHER);
      expect(store.get()).toEqual({ ...OTHER, artworkUrl: null, cached: null });
    });

    it("never reports a record whose videoId is not the current one", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.setTrack(OTHER);
      expect(store.get()?.videoId).toBe("xyz");
    });
  });

  describe("regressions", () => {
    it("regression: a repeat announcement keeps artwork that already arrived", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.setArtwork("abc", "art");
      store.setTrack(TRACK);
      expect(store.get()?.artworkUrl).toBe("art");
    });

    it("regression: a repeat announcement keeps the cache state already probed", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.setCached("abc", false);
      store.setTrack(TRACK);
      expect(store.get()?.cached).toBe(false);
    });

    it("regression: a late answer for a replaced track is dropped", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.setTrack(OTHER);
      store.setArtwork("abc", "stale art");
      store.setCached("abc", true);
      expect(store.get()).toEqual({ ...OTHER, artworkUrl: null, cached: null });
    });

    it("regression: a repeat with a missing name does not blank the one already shown", () => {
      const store = createComingUpStore();
      store.setTrack(TRACK);
      store.setTrack({ videoId: "abc", title: null, artist: null });
      expect(store.get()).toMatchObject({ title: "Nightcall", artist: "Kavinsky" });
    });
  });
});
