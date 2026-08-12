import { shouldPublishPlayerState } from "@/pageworld/player-bridge";
import type { PublishInput } from "@/pageworld/player-bridge";
import { describe, expect, it } from "vitest";

const playing: PublishInput = {
  snapshot: { videoId: "DJCB1ZlseJ8", durationSeconds: 215.1 },
  adPlaying: false,
  betterLyricsPublishing: false,
};

describe("shouldPublishPlayerState", () => {
  it("publishes what the player bar says while a track is playing", () => {
    expect(shouldPublishPlayerState(playing)).toBe(true);
  });

  it("stands down while Better Lyrics is publishing the same state", () => {
    expect(shouldPublishPlayerState({ ...playing, betterLyricsPublishing: true })).toBe(false);
  });

  it("says nothing while an ad plays, because the bar is timing the ad", () => {
    expect(shouldPublishPlayerState({ ...playing, adPlaying: true })).toBe(false);
  });
});

describe("edge cases", () => {
  it("says nothing when there is no snapshot to send", () => {
    expect(shouldPublishPlayerState({ ...playing, snapshot: null })).toBe(false);
  });

  it("stays silent during an ad even when Better Lyrics is absent", () => {
    expect(shouldPublishPlayerState({ ...playing, adPlaying: true, betterLyricsPublishing: false })).toBe(false);
  });

  it("prefers silence when both reasons to stay quiet hold at once", () => {
    expect(shouldPublishPlayerState({ ...playing, adPlaying: true, betterLyricsPublishing: true })).toBe(false);
  });
});

describe("invariants", () => {
  it("only ever publishes when all three conditions allow it", () => {
    for (const adPlaying of [true, false]) {
      for (const betterLyricsPublishing of [true, false]) {
        for (const snapshot of [playing.snapshot, null]) {
          const allowed = !adPlaying && !betterLyricsPublishing && snapshot !== null;
          expect(shouldPublishPlayerState({ snapshot, adPlaying, betterLyricsPublishing })).toBe(allowed);
        }
      }
    }
  });

  it("is a pure decision, since it is asked once a second and on every media event", () => {
    expect(shouldPublishPlayerState(playing)).toBe(shouldPublishPlayerState(playing));
  });
});

describe("regressions", () => {
  it("regression: an ad's length is never attributed to the track the player already names", () => {
    const duringAnAdBlock: PublishInput = {
      snapshot: { videoId: "oodQMZLjoBU", durationSeconds: 46 },
      adPlaying: true,
      betterLyricsPublishing: false,
    };
    expect(shouldPublishPlayerState(duringAnAdBlock)).toBe(false);
  });

  it("regression: the real length is published once the ad is over", () => {
    const afterTheAd: PublishInput = {
      snapshot: { videoId: "oodQMZLjoBU", durationSeconds: 237 },
      adPlaying: false,
      betterLyricsPublishing: false,
    };
    expect(shouldPublishPlayerState(afterTheAd)).toBe(true);
  });
});
