import { type QueueItem, currentTrackInQueue, nextTrackInQueue, nextVideoIdInQueue } from "@/capture/next-track";
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
    it("prefers the selection over the id it is handed", () => {
      expect(currentTrackInQueue(described(IDS, 0), IDS[2])?.videoId).toBe(IDS[0]);
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
  });
});
