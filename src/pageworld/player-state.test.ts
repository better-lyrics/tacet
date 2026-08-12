import { readPlayerSnapshot } from "@/pageworld/player-state";
import type { YtPlayer } from "@/capture/yt-player";
import { describe, expect, it } from "vitest";

function playerReporting(videoData: unknown, duration: number): YtPlayer {
  return {
    getVideoData: () => videoData as ReturnType<NonNullable<YtPlayer["getVideoData"]>>,
    getDuration: () => duration,
  };
}

describe("readPlayerSnapshot", () => {
  it("reports the track the player names, with its duration", () => {
    expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, 215.16))).toEqual({
      videoId: "abc123",
      durationSeconds: 215.16,
    });
  });

  it("refuses an ad the player admits to", () => {
    expect(readPlayerSnapshot(playerReporting({ video_id: "abc123", isAd: true }, 20))).toBeNull();
  });

  it("refuses an ad the player does not admit to, on the page's own signal", () => {
    expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, 237), 46, true)).toBeNull();
  });

  it("regression: an ad's clock is never returned as the next track's length", () => {
    const duringAnAdBlock = readPlayerSnapshot(playerReporting({ video_id: "oodQMZLjoBU", isAd: null }, 237), 46, true);
    expect(duringAnAdBlock).toBeNull();
    expect(readPlayerSnapshot(playerReporting({ video_id: "oodQMZLjoBU" }, 237), 237, false)).toEqual({
      videoId: "oodQMZLjoBU",
      durationSeconds: 237,
    });
  });

  it("refuses a player that has not loaded a track yet", () => {
    expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, 0))).toBeNull();
  });

  describe("edge cases", () => {
    it("refuses a player that is not there", () => {
      expect(readPlayerSnapshot(null)).toBeNull();
    });

    it("refuses a player missing either accessor, rather than assuming a default", () => {
      expect(readPlayerSnapshot({})).toBeNull();
      expect(readPlayerSnapshot({ getDuration: () => 200 })).toBeNull();
      expect(readPlayerSnapshot({ getVideoData: () => ({ video_id: "abc123" }) })).toBeNull();
    });

    it("refuses an empty or non-string video id", () => {
      expect(readPlayerSnapshot(playerReporting({ video_id: "" }, 200))).toBeNull();
      expect(readPlayerSnapshot(playerReporting({ video_id: 42 }, 200))).toBeNull();
      expect(readPlayerSnapshot(playerReporting({}, 200))).toBeNull();
    });

    it("refuses a live stream or a still-resolving duration", () => {
      expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, Number.POSITIVE_INFINITY))).toBeNull();
      expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, Number.NaN))).toBeNull();
      expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, -1))).toBeNull();
    });
  });

  describe("error paths", () => {
    it("refuses rather than throwing when the player's accessors throw", () => {
      expect(
        readPlayerSnapshot({
          getVideoData: () => {
            throw new Error("player not ready");
          },
          getDuration: () => 200,
        })
      ).toBeNull();

      expect(
        readPlayerSnapshot({
          getVideoData: () => ({ video_id: "abc123" }),
          getDuration: () => {
            throw new Error("player not ready");
          },
        })
      ).toBeNull();
    });

    it("refuses when the player answers with nothing", () => {
      expect(readPlayerSnapshot({ getVideoData: () => null as never, getDuration: () => 200 })).toBeNull();
    });
  });

  describe("invariants", () => {
    it("distinguishes two tracks of identical duration", () => {
      const first = readPlayerSnapshot(playerReporting({ video_id: "first" }, 200));
      const second = readPlayerSnapshot(playerReporting({ video_id: "second" }, 200));
      expect(first?.videoId).not.toBe(second?.videoId);
    });
  });
});
