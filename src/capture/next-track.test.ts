import {
  type QueueItem,
  currentTrackInQueue,
  dropSpareCounterparts,
  nextTrackInQueue,
  nextVideoIdInQueue,
} from "@/capture/next-track";
import { describe, expect, it } from "vitest";

function queue(videoIds: (string | null)[], selectedIndex: number): QueueItem[] {
  return videoIds.map((videoId, index) => ({ videoId, selected: index === selectedIndex }));
}

const IDS = ["DJCB1ZlseJ8", "M2K8sB8y-v4", "Qy9LTRu89FA"];

describe("nextVideoIdInQueue", () => {
  it("returns the item after the selected one", () => {
    expect(nextVideoIdInQueue(queue(IDS, 0), IDS[0])).toBe("M2K8sB8y-v4");
    expect(nextVideoIdInQueue(queue(IDS, 1), IDS[1])).toBe("Qy9LTRu89FA");
  });

  it("returns nothing on the last item", () => {
    expect(nextVideoIdInQueue(queue(IDS, 2), IDS[2])).toBeNull();
  });

  it("falls back to the playing id when nothing is marked selected", () => {
    expect(nextVideoIdInQueue(queue(IDS, -1), IDS[0])).toBe("M2K8sB8y-v4");
  });

  describe("edge cases", () => {
    it("returns nothing for an empty queue", () => {
      expect(nextVideoIdInQueue([], "DJCB1ZlseJ8")).toBeNull();
    });

    it("returns nothing when neither the selection nor the id is found", () => {
      expect(nextVideoIdInQueue(queue(IDS, -1), "unknown")).toBeNull();
      expect(nextVideoIdInQueue(queue(IDS, -1), null)).toBeNull();
    });

    it("returns nothing when the next item has no id yet", () => {
      expect(nextVideoIdInQueue(queue([IDS[0], null], 0), IDS[0])).toBeNull();
    });

    it("refuses a next item repeating the track already playing", () => {
      expect(nextVideoIdInQueue(queue([IDS[0], IDS[0]], 0), IDS[0])).toBeNull();
    });

    it("prefers the selection over a duplicate of the playing id earlier in the queue", () => {
      const items = queue([IDS[0], IDS[1], IDS[0], IDS[2]], 2);
      expect(nextVideoIdInQueue(items, IDS[0])).toBe("Qy9LTRu89FA");
    });
  });

  describe("invariants", () => {
    it("never returns the track already playing", () => {
      for (let index = 0; index < IDS.length; index++) {
        expect(nextVideoIdInQueue(queue(IDS, index), IDS[index])).not.toBe(IDS[index]);
      }
    });
  });
});

const ART = "https://yt3.googleusercontent.com/AbCdEf=w544-h544-l90-rj";

function described(videoIds: (string | null)[], selectedIndex: number): QueueItem[] {
  return videoIds.map((videoId, index) => ({
    videoId,
    selected: index === selectedIndex,
    title: videoId === null ? null : `Track ${index}`,
    artist: "Men I Trust",
    artworkUrl: `${ART}#${index}`,
  }));
}

describe("currentTrackInQueue", () => {
  describe("happy path", () => {
    it("describes the selected row", () => {
      expect(currentTrackInQueue(described(IDS, 1), IDS[1])).toEqual({
        videoId: IDS[1],
        title: "Track 1",
        artist: "Men I Trust",
        artworkUrl: `${ART}#1`,
      });
    });

    it("falls back to the playing id when nothing is marked selected", () => {
      expect(currentTrackInQueue(described(IDS, -1), IDS[2])?.videoId).toBe(IDS[2]);
    });
  });

  describe("edge cases", () => {
    it("returns nothing for an empty queue", () => {
      expect(currentTrackInQueue([], IDS[0])).toBeNull();
    });

    it("returns nothing when neither the selection nor the id is found", () => {
      expect(currentTrackInQueue(described(IDS, -1), "unknown")).toBeNull();
      expect(currentTrackInQueue(described(IDS, -1), null)).toBeNull();
    });

    it("returns nothing when the selected row has no id yet", () => {
      expect(currentTrackInQueue(described([null, IDS[1]], 0), null)).toBeNull();
    });

    it("keeps a missing name null rather than inventing one", () => {
      const items: QueueItem[] = [{ videoId: IDS[0], selected: true }];
      expect(currentTrackInQueue(items, IDS[0])).toEqual({
        videoId: IDS[0],
        title: null,
        artist: null,
        artworkUrl: null,
      });
    });
  });

  describe("invariants", () => {
    // This used to prefer the selection outright. It still does when exactly one
    // row claims it, which is the ordinary case, but the queue's own play state
    // now outranks both the selection and any id.
    it("trusts a lone selection over the id it is handed", () => {
      expect(currentTrackInQueue(described(IDS, 0), IDS[2])?.videoId).toBe(IDS[0]);
    });

    it("falls back to the selection when it is handed no id at all", () => {
      expect(currentTrackInQueue(described(IDS, 1), null)?.videoId).toBe(IDS[1]);
    });
  });
});

describe("nextTrackInQueue", () => {
  describe("happy path", () => {
    it("carries the next row's own square artwork", () => {
      expect(nextTrackInQueue(described(IDS, 0), IDS[0])).toEqual({
        videoId: IDS[1],
        title: "Track 1",
        artist: "Men I Trust",
        artworkUrl: `${ART}#1`,
      });
    });
  });

  describe("edge cases", () => {
    it("returns nothing on the last row", () => {
      expect(nextTrackInQueue(described(IDS, 2), IDS[2])).toBeNull();
    });
  });

  describe("regressions", () => {
    it("regression: a row with no thumbnail yields a null url rather than undefined", () => {
      const items: QueueItem[] = [
        { videoId: IDS[0], selected: true },
        { videoId: IDS[1], selected: false },
      ];
      expect(nextTrackInQueue(items, IDS[0])?.artworkUrl).toBeNull();
    });

    const realQueueShape: QueueItem[] = [
      { videoId: "played-one", selected: false, playState: "default" },
      { videoId: "stale-selected", selected: true, playState: "default" },
      { videoId: "played-two", selected: false, playState: "default" },
      { videoId: "played-three", selected: false, playState: "default" },
      { videoId: "playing-now", selected: true, playState: "playing" },
      { videoId: "genuinely-next", selected: false, playState: "default" },
    ];

    it("regression: a stale extra selection does not name an already played track as next", () => {
      expect(nextVideoIdInQueue(realQueueShape, "playing-now")).toBe("genuinely-next");
    });

    it("regression: the play state decides it without consulting the id at all", () => {
      expect(nextVideoIdInQueue(realQueueShape, null)).toBe("genuinely-next");
    });

    it("regression: a lying id does not move the answer off the row that is playing", () => {
      expect(nextVideoIdInQueue(realQueueShape, "stale-selected")).toBe("genuinely-next");
    });

    it("regression: with no play state, several selections resolve to the last rather than the first", () => {
      const items: QueueItem[] = [
        { videoId: "stale-selected", selected: true },
        { videoId: "wrongly-next", selected: false },
        { videoId: "playing-now", selected: true },
        { videoId: "genuinely-next", selected: false },
      ];
      expect(nextVideoIdInQueue(items, null)).toBe("genuinely-next");
    });

    it("regression: a paused row still counts as the row the listener is on", () => {
      const items: QueueItem[] = [
        { videoId: "stale-selected", selected: true, playState: "default" },
        { videoId: "playing-now", selected: false, playState: "paused" },
        { videoId: "genuinely-next", selected: false, playState: "default" },
      ];
      expect(nextVideoIdInQueue(items, null)).toBe("genuinely-next");
    });
  });
});

describe("dropSpareCounterparts", () => {
  const measured: QueueItem[] = [
    { videoId: "9E3jQcUkXdQ", selected: false, playState: "default", wrapper: 0, counterpart: false },
    { videoId: "0LMwgWFzDjU", selected: true, playState: "default", wrapper: 0, counterpart: true },
    { videoId: "5Y3rAfAafcQ", selected: true, playState: "paused", wrapper: 1, counterpart: false },
    { videoId: "S51-qzfLdIc", selected: false, playState: "default", wrapper: 1, counterpart: true },
    { videoId: "qU9mHegkTc4", selected: false, playState: "default", wrapper: null, counterpart: false },
  ];

  it("keeps one row per wrapper, preferring the primary", () => {
    expect(dropSpareCounterparts(measured).map(item => item.videoId)).toEqual([
      "9E3jQcUkXdQ",
      "5Y3rAfAafcQ",
      "qU9mHegkTc4",
    ]);
  });

  it("leaves a row that belongs to no wrapper alone", () => {
    const items: QueueItem[] = [{ videoId: "alone", selected: false }];
    expect(dropSpareCounterparts(items)).toEqual(items);
  });

  describe("edge cases", () => {
    it("keeps the counterpart when the counterpart is the row that is playing", () => {
      const items: QueueItem[] = [
        { videoId: "song-version", selected: false, playState: "default", wrapper: 0, counterpart: false },
        { videoId: "video-version", selected: false, playState: "playing", wrapper: 0, counterpart: true },
      ];
      expect(dropSpareCounterparts(items).map(item => item.videoId)).toEqual(["video-version"]);
    });

    it("keeps a lone counterpart rather than dropping the wrapper entirely", () => {
      const items: QueueItem[] = [{ videoId: "only", selected: false, wrapper: 0, counterpart: true }];
      expect(dropSpareCounterparts(items).map(item => item.videoId)).toEqual(["only"]);
    });

    it("answers with nothing for an empty queue", () => {
      expect(dropSpareCounterparts([])).toEqual([]);
    });
  });

  describe("invariants", () => {
    it("never returns more than one row per wrapper", () => {
      const wrappers = dropSpareCounterparts(measured).map(item => item.wrapper);
      const named = wrappers.filter(wrapper => typeof wrapper === "number");
      expect(new Set(named).size).toBe(named.length);
    });

    it("never invents a row or reorders what it keeps", () => {
      const kept = dropSpareCounterparts(measured);
      expect(measured.filter(item => kept.includes(item))).toEqual(kept);
    });
  });

  describe("regressions", () => {
    it("regression: the track after a wrapped row is the next song, not its own counterpart", () => {
      expect(nextVideoIdInQueue(dropSpareCounterparts(measured), "5Y3rAfAafcQ")).toBe("qU9mHegkTc4");
    });

    it("regression: without the filter the queue names the same song as next", () => {
      expect(nextVideoIdInQueue(measured, "5Y3rAfAafcQ")).toBe("S51-qzfLdIc");
    });
  });
});
