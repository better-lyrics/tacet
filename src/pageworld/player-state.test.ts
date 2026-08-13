import { remainingForCue } from "@/automix/cue-clock";
import { mayArmStaging } from "@/automix/staged-source";
import { readPlayerSnapshot } from "@/pageworld/player-state";
import type { PlayerSnapshot } from "@/pageworld/player-state";
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
    expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, 215.16), 216)).toEqual({
      videoId: "abc123",
      durationSeconds: 216,
      durationTrusted: true,
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
      durationTrusted: true,
    });
  });

  it("distrusts the length while the bar is still timing an ad the attribute has released", () => {
    const barStillOnTheAd = readPlayerSnapshot(
      playerReporting({ video_id: "oodQMZLjoBU", isAd: null }, 237),
      14,
      false
    );
    expect(barStillOnTheAd?.durationSeconds).toBe(14);
    expect(barStillOnTheAd?.durationTrusted).toBe(false);
  });

  it("trusts the bar during a gapless append, where the player is timing the buffer", () => {
    expect(readPlayerSnapshot(playerReporting({ video_id: "abc123" }, 49.9), 315)?.durationTrusted).toBe(true);
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

  // A snapshot the cue cannot use is worth nothing, and distrust does not
  // announce itself: it arrives as NaN, nothing stages, no fade ever arms, and
  // the only symptom is a listener saying crossfade works sometimes. So the
  // chain is driven end to end here rather than left to the unit tests either
  // side of it.
  describe("what the cue can do with the snapshot", () => {
    const remainingFor = (snapshot: PlayerSnapshot | null, positionSeconds: number): number =>
      remainingForCue({
        trackDurationSeconds: snapshot?.durationTrusted === true ? snapshot.durationSeconds : Number.NaN,
        trackPositionSeconds: positionSeconds,
        deckDurationSeconds: Number.NaN,
        deckPositionSeconds: Number.NaN,
      });

    it("regression: a gapless append still lets a fade arm", () => {
      // Measured on a real session: a 315 s track fifteen seconds in read 49.9
      // from getDuration() while the player bar showed 0:15 / 5:15.
      const appended = readPlayerSnapshot(playerReporting({ video_id: "appended" }, 49.9), 315);
      expect(appended?.durationSeconds).toBe(315);
      expect(remainingFor(appended, 307)).toBeCloseTo(8);
      expect(mayArmStaging(remainingFor(appended, 307), 8, 6)).toBe(true);
    });

    it("regression: a bar still timing an ad arms nothing", () => {
      const barOnTheAd = readPlayerSnapshot(playerReporting({ video_id: "afterAnAd" }, 237), 14);
      expect(remainingFor(barOnTheAd, 5)).toBeNaN();
      expect(mayArmStaging(remainingFor(barOnTheAd, 5), 8, 6)).toBe(false);
    });

    it("an ordinary track arms only inside the decode window", () => {
      const ordinary = readPlayerSnapshot(playerReporting({ video_id: "ordinary" }, 215.11), 216);
      expect(mayArmStaging(remainingFor(ordinary, 10), 8, 6)).toBe(false);
      expect(mayArmStaging(remainingFor(ordinary, 205), 8, 6)).toBe(true);
    });
  });
});
