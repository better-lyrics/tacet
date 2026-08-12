import { describeStandDown, standDownReason } from "@/pageworld/stand-down";
import { describe, expect, it } from "vitest";

const playing = { adPlaying: false, playbackRate: 1 };

describe("standDownReason", () => {
  it("lets ordinary playback through", () => {
    expect(standDownReason(playing)).toBeNull();
  });

  it("stands down for an ad", () => {
    expect(standDownReason({ ...playing, adPlaying: true })).toEqual({ kind: "ad" });
  });

  it("stands down for a speed the stems cannot follow", () => {
    expect(standDownReason({ ...playing, playbackRate: 1.25 })).toEqual({ kind: "speed", rate: 1.25 });
    expect(standDownReason({ ...playing, playbackRate: 0.5 })).toEqual({ kind: "speed", rate: 0.5 });
  });
});

describe("edge cases", () => {
  it("prefers the ad when both hold, since the ad is the louder reason", () => {
    expect(standDownReason({ adPlaying: true, playbackRate: 2 })).toEqual({ kind: "ad" });
  });

  it("stands down for a rate it cannot read, rather than guessing it is 1x", () => {
    expect(standDownReason({ ...playing, playbackRate: Number.NaN })).not.toBeNull();
  });

  it("treats a rate a hair off unity as a speed change", () => {
    expect(standDownReason({ ...playing, playbackRate: 1.0001 })).not.toBeNull();
  });

  it("describes every reason in words a log can carry", () => {
    expect(describeStandDown({ kind: "ad" })).toContain("ad");
    expect(describeStandDown({ kind: "speed", rate: 2 })).toContain("2x");
  });
});

describe("invariants", () => {
  it("never stands down while an ordinary track plays at 1x", () => {
    expect(standDownReason({ adPlaying: false, playbackRate: 1 })).toBeNull();
  });

  it("is a pure decision, since it is asked once a second and again on every rate change", () => {
    const input = { adPlaying: false, playbackRate: 1.5 };
    expect(standDownReason(input)).toEqual(standDownReason(input));
  });
});

describe("regressions", () => {
  it("regression: a speed change hands the listener vanilla audio rather than pitch-shifted stems", () => {
    const reason = standDownReason({ adPlaying: false, playbackRate: 1.25 });
    expect(reason).not.toBeNull();
    if (reason === null) return;
    expect(describeStandDown(reason)).toContain("pitch");
  });
});
