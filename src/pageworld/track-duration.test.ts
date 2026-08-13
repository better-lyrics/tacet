import { describe, expect, it } from "vitest";
import {
  CLOCK_AGREEMENT_TOLERANCE_S,
  chooseTrackDuration,
  clocksAgree,
  parseClockDuration,
} from "@/pageworld/track-duration";

describe("parseClockDuration", () => {
  it("takes the total, not the elapsed", () => {
    expect(parseClockDuration("0:15 / 5:15")).toBe(315);
    expect(parseClockDuration("0:00 / 3:36")).toBe(216);
  });

  it("handles hours on either side", () => {
    expect(parseClockDuration("1:02:03 / 1:05:00")).toBe(3900);
    expect(parseClockDuration("59:59 / 1:00:00")).toBe(3600);
  });

  it("tolerates surrounding whitespace and spacing round the slash", () => {
    expect(parseClockDuration("  2:10/4:20  ")).toBe(260);
    expect(parseClockDuration("2:10   /   4:20")).toBe(260);
  });

  describe("edge cases", () => {
    it("rejects text that is not a clock", () => {
      expect(parseClockDuration("")).toBeNaN();
      expect(parseClockDuration("Play")).toBeNaN();
      expect(parseClockDuration("3:36")).toBeNaN();
    });

    it("rejects a zero total", () => {
      expect(parseClockDuration("0:00 / 0:00")).toBeNaN();
    });

    it("rejects an impossible seconds field rather than misreading it", () => {
      expect(parseClockDuration("0:00 / 3:76")).toBeNaN();
    });
  });
});

describe("chooseTrackDuration", () => {
  it("prefers the clock", () => {
    expect(chooseTrackDuration(315, 49.9)).toBe(315);
  });

  it("falls back to the player when the clock is unreadable", () => {
    expect(chooseTrackDuration(Number.NaN, 215.16)).toBe(215.16);
  });

  it("reports nothing when neither is usable", () => {
    expect(chooseTrackDuration(Number.NaN, 0)).toBe(0);
    expect(chooseTrackDuration(0, Number.NaN)).toBe(0);
  });

  describe("regressions", () => {
    it("regression: a buffered-length getDuration no longer wins over the real track", () => {
      expect(chooseTrackDuration(315, 49.9)).toBe(315);
      expect(chooseTrackDuration(222, 315)).toBe(222);
    });
  });
});

describe("clocksAgree", () => {
  it("agrees when the bar and the player report the same track", () => {
    expect(clocksAgree(216, 215.11)).toBe(true);
  });

  it("refuses a bar still timing an ad against the player's real duration", () => {
    expect(clocksAgree(14, 237)).toBe(false);
    expect(clocksAgree(46, 237)).toBe(false);
  });

  it("refuses a gapless append, where the two describe different things", () => {
    expect(clocksAgree(315, 49.9)).toBe(false);
    expect(clocksAgree(222, 315)).toBe(false);
  });

  describe("edge cases", () => {
    it("refuses when either side is unreadable", () => {
      expect(clocksAgree(Number.NaN, 215)).toBe(false);
      expect(clocksAgree(215, Number.NaN)).toBe(false);
      expect(clocksAgree(0, 215)).toBe(false);
      expect(clocksAgree(215, 0)).toBe(false);
    });

    it("does not care which side is larger", () => {
      expect(clocksAgree(215, 218)).toBe(clocksAgree(218, 215));
    });
  });

  describe("invariants", () => {
    it("agrees exactly to the tolerance and no further", () => {
      expect(clocksAgree(200, 200 + CLOCK_AGREEMENT_TOLERANCE_S)).toBe(true);
      expect(clocksAgree(200, 200 + CLOCK_AGREEMENT_TOLERANCE_S + 0.01)).toBe(false);
    });
  });

  describe("regressions", () => {
    it("regression: the bar reading an ad's 0:14 against a 237 s track is not a track length", () => {
      expect(chooseTrackDuration(14, 237)).toBe(14);
      expect(clocksAgree(14, 237)).toBe(false);
    });
  });
});
