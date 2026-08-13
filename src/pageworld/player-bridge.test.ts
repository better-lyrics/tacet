import { shouldPublishPlayerState } from "@/pageworld/player-bridge";
import type { PublishInput } from "@/pageworld/player-bridge";
import { describe, expect, it } from "vitest";

const playing: PublishInput = {
  snapshot: { videoId: "DJCB1ZlseJ8", durationSeconds: 215.1, durationTrusted: true },
  betterLyricsPublishing: false,
};

describe("shouldPublishPlayerState", () => {
  it("publishes what the player bar says while a track is playing", () => {
    expect(shouldPublishPlayerState(playing)).toBe(true);
  });

  it("stands down while Better Lyrics is publishing the same state", () => {
    expect(shouldPublishPlayerState({ ...playing, betterLyricsPublishing: true })).toBe(false);
  });

  it("says nothing when there is no snapshot to send", () => {
    expect(shouldPublishPlayerState({ ...playing, snapshot: null })).toBe(false);
  });
});

describe("invariants", () => {
  it("only ever publishes when both conditions allow it", () => {
    for (const betterLyricsPublishing of [true, false]) {
      for (const snapshot of [playing.snapshot, null]) {
        const allowed = !betterLyricsPublishing && snapshot !== null;
        expect(shouldPublishPlayerState({ snapshot, betterLyricsPublishing })).toBe(allowed);
      }
    }
  });

  it("is a pure decision, since it is asked once a second and on every media event", () => {
    expect(shouldPublishPlayerState(playing)).toBe(shouldPublishPlayerState(playing));
  });
});

describe("regressions", () => {
  it("regression: an ad arrives here as no snapshot at all, so nothing is published", () => {
    expect(shouldPublishPlayerState({ snapshot: null, betterLyricsPublishing: false })).toBe(false);
  });
});
