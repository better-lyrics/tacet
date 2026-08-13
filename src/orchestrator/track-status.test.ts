import { type TrackNames, createTrackStatusStore } from "@/orchestrator/track-status";
import { describe, expect, it } from "vitest";

const ART = "https://yt3.googleusercontent.com/AbCdEf=w544-h544-l90-rj";

function names(videoId: string, title: string | null, artworkUrl: string | null = null): TrackNames {
  return { videoId, title, artist: title === null ? null : "Men I Trust", artworkUrl };
}

const NOW = names("abc", "Numb", ART);
const NEXT = names("xyz", "Show Me How", `${ART}#2`);
const THIRD = names("qrs", "Another One");

describe("track status store", () => {
  describe("happy path", () => {
    it("starts empty", () => {
      expect(createTrackStatusStore().get()).toEqual({ now: null, next: null });
    });

    it("holds both rows with the artwork the queue gave them", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      expect(store.get()).toEqual({
        now: { ...NOW, cached: null, activity: null, fraction: null },
        next: { ...NEXT, cached: null, activity: null, fraction: null },
      });
    });

    it("takes a late artwork answer for whichever row it names", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: names("abc", "Numb"), next: names("xyz", "Show Me How") });
      store.setArtwork("xyz", ART);
      expect(store.get().next?.artworkUrl).toBe(ART);
      expect(store.get().now?.artworkUrl).toBeNull();
    });

    it("takes a cache verdict for whichever row it names", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setCached("xyz", true);
      expect(store.get().next?.cached).toBe(true);
      expect(store.get().now?.cached).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("ignores artwork and cache verdicts for a track it has never held", () => {
      const store = createTrackStatusStore();
      store.setArtwork("abc", ART);
      store.setCached("abc", true);
      expect(store.get()).toEqual({ now: null, next: null });
    });

    it("holds a playing row with nothing after it", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: null });
      expect(store.get().now?.videoId).toBe("abc");
      expect(store.get().next).toBeNull();
    });

    it("clears", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.clear();
      expect(store.get()).toEqual({ now: null, next: null });
    });

    it("keeps a null title rather than inventing one", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: names("abc", null), next: null });
      expect(store.get().now).toMatchObject({ title: null, artist: null });
    });
  });

  describe("invariants", () => {
    it("a genuinely new track in a slot arrives with nothing carried over", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setCached("abc", true);
      store.setTracks({ now: THIRD, next: null });
      expect(store.get().now).toEqual({ ...THIRD, cached: null, activity: null, fraction: null });
    });

    it("never reports a row under a videoId it no longer holds", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setTracks({ now: THIRD, next: null });
      expect(store.get().now?.videoId).toBe("qrs");
      expect(store.get().next).toBeNull();
    });
  });

  describe("regressions", () => {
    it("regression: an advance promotes the next row with its artwork and cache verdict intact", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setCached("xyz", true);
      store.setTracks({ now: names("xyz", "Show Me How"), next: THIRD });
      expect(store.get().now).toEqual({ ...NEXT, cached: true, activity: null, fraction: null });
    });

    it("regression: a repeat read keeps artwork that already arrived", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: names("abc", "Numb"), next: null });
      store.setArtwork("abc", ART);
      store.setTracks({ now: names("abc", "Numb"), next: null });
      expect(store.get().now?.artworkUrl).toBe(ART);
    });

    it("regression: a repeat read keeps the cache verdict already probed", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setCached("xyz", false);
      store.setTracks({ now: NOW, next: NEXT });
      expect(store.get().next?.cached).toBe(false);
    });

    it("regression: a late answer for a replaced track is dropped", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setTracks({ now: THIRD, next: null });
      store.setArtwork("abc", "stale art");
      store.setCached("abc", true);
      expect(store.get().now).toEqual({ ...THIRD, cached: null, activity: null, fraction: null });
    });

    it("regression: a repeat with a missing name does not blank the one already shown", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: null });
      store.setTracks({ now: names("abc", null), next: null });
      expect(store.get().now).toMatchObject({ title: "Numb", artist: "Men I Trust", artworkUrl: ART });
    });
  });
});

describe("setActivity", () => {
  it("records what the track coming next is doing", () => {
    const store = createTrackStatusStore();
    store.setTracks({ now: NOW, next: NEXT });
    store.setActivity(NEXT.videoId, "downloading", 0.25);
    expect(store.get().next?.activity).toBe("downloading");
    expect(store.get().next?.fraction).toBe(0.25);
  });

  describe("edge cases", () => {
    it("ignores a track it has never heard of", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setActivity("unknown", "separating");
      expect(store.get().now?.activity).toBeNull();
      expect(store.get().next?.activity).toBeNull();
    });

    it("keeps the progress of the activity in force when a later message goes backwards", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setActivity(NEXT.videoId, "separating", 0.6);
      store.setActivity(NEXT.videoId, "downloading", 0.1);
      expect(store.get().next?.activity).toBe("separating");
      expect(store.get().next?.fraction).toBe(0.6);
    });
  });

  describe("invariants", () => {
    it("touches only the row it names", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setActivity(NEXT.videoId, "ready");
      expect(store.get().now?.activity).toBeNull();
    });

    it("a genuinely new track in the slot starts with no activity", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setActivity(NEXT.videoId, "ready");
      store.setTracks({ now: NEXT, next: THIRD });
      expect(store.get().next?.activity).toBeNull();
    });

    it("an advance carries the activity with the track it belongs to", () => {
      const store = createTrackStatusStore();
      store.setTracks({ now: NOW, next: NEXT });
      store.setActivity(NEXT.videoId, "ready");
      store.setTracks({ now: NEXT, next: THIRD });
      expect(store.get().now?.activity).toBe("ready");
    });
  });
});
