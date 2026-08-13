import { describe, expect, it } from "vitest";
import {
  CLOCK_JITTER_S,
  CLOCK_SETTLE_MS,
  chooseTrackDuration,
  clockDurationSettled,
  noteClockDuration,
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

describe("a settled bar clock", () => {
  const settleOver = (readings: [number, number][]): boolean => {
    let settling = null;
    let settled = false;
    for (const [seconds, atMs] of readings) {
      settling = noteClockDuration(settling, seconds, atMs);
      settled = clockDurationSettled(settling, atMs);
    }
    return settled;
  };

  it("is not settled the moment a total first appears", () => {
    expect(settleOver([[216, 0]])).toBe(false);
  });

  it("settles once the total has held for the settle window", () => {
    expect(
      settleOver([
        [216, 0],
        [216, CLOCK_SETTLE_MS],
      ])
    ).toBe(true);
  });

  it("refuses a bar still timing an ad, because its total moves", () => {
    // Measured across one ad block: 0:13, 0:14, 0:46, then the real 3:57.
    expect(
      settleOver([
        [13, 0],
        [14, 1000],
        [46, 2000],
        [237, 3000],
      ])
    ).toBe(false);
  });

  it("stays settled once the real track's total arrives and holds", () => {
    expect(
      settleOver([
        [13, 0],
        [237, 1000],
        [237, 1000 + CLOCK_SETTLE_MS],
      ])
    ).toBe(true);
  });

  describe("edge cases", () => {
    it("is never settled while the bar is unreadable", () => {
      expect(
        settleOver([
          [Number.NaN, 0],
          [Number.NaN, 10_000],
        ])
      ).toBe(false);
      expect(
        settleOver([
          [0, 0],
          [0, 10_000],
        ])
      ).toBe(false);
    });

    it("an unreadable bar resets a total that had already settled", () => {
      expect(
        settleOver([
          [216, 0],
          [216, CLOCK_SETTLE_MS],
          [Number.NaN, CLOCK_SETTLE_MS + 1],
        ])
      ).toBe(false);
    });
  });

  describe("rounding jitter", () => {
    it("a total flickering between two adjacent seconds stays settled", () => {
      expect(
        settleOver([
          [218, 0],
          [218, CLOCK_SETTLE_MS],
          [219, CLOCK_SETTLE_MS + 500],
          [218, CLOCK_SETTLE_MS + 1000],
        ])
      ).toBe(true);
    });

    it("a total flickering before it ever settles still settles on time", () => {
      expect(
        settleOver([
          [218, 0],
          [219, 500],
          [218, 1000],
          [219, CLOCK_SETTLE_MS],
        ])
      ).toBe(true);
    });

    it("a total creeping a second at a time is not jitter and resets", () => {
      // Measured against the anchor, not the previous reading, so 220 is two
      // away from 218 and counts as a change however slowly it got there.
      expect(
        settleOver([
          [218, 0],
          [219, 500],
          [220, 1000],
          [220, 1500],
        ])
      ).toBe(false);
    });

    it("a change of exactly the slack is absorbed and anything past it is not", () => {
      const held = (to: number): boolean =>
        settleOver([
          [200, 0],
          [to, CLOCK_SETTLE_MS],
        ]);
      expect(held(200 + CLOCK_JITTER_S)).toBe(true);
      expect(held(200 + CLOCK_JITTER_S + 0.01)).toBe(false);
    });
  });

  describe("regressions", () => {
    // The whole reason the player's own duration is no longer consulted.
    it("regression: a gapless append never unsettles the bar", () => {
      // getDuration climbed 289.0, 290.6, 296.7, 304.9 across these reads while
      // the bar held 289, and the fade was armed and waiting throughout.
      expect(
        settleOver([
          [289, 0],
          [289, 2000],
          [289, 4000],
          [289, 6000],
        ])
      ).toBe(true);
    });

    it("regression: a filling buffer on the next track never unsettles the bar", () => {
      // getDuration read 29.9, 49.9, 59.9, 79.8 against a steady bar of 134.
      expect(
        settleOver([
          [134, 0],
          [134, 2000],
          [134, 4000],
          [134, 6000],
        ])
      ).toBe(true);
    });

    it("regression: the bar reading an ad's 0:14 against a 237 s track is not a track length", () => {
      expect(chooseTrackDuration(14, 237)).toBe(14);
      expect(
        settleOver([
          [14, 0],
          [237, 500],
        ])
      ).toBe(false);
    });

    it("regression: an ad handing over is a jump, so the slack never absorbs it", () => {
      // 0:13, 0:14, 0:46, then the real 3:57. The 13 to 14 step is inside the
      // slack, and every later one is far outside it, so the window still
      // resets on the handover itself.
      expect(
        settleOver([
          [13, 0],
          [14, 1000],
          [46, 2000],
          [237, 3000],
          [237, 3000 + CLOCK_SETTLE_MS - 1],
        ])
      ).toBe(false);
    });
  });
});
