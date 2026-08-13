import { describe, expect, it } from "vitest";
import { fadeCeilingSeconds, remainingForCue } from "@/automix/cue-clock";
import type { CueClockInput } from "@/automix/cue-clock";

const wholeTrack: CueClockInput = {
  trackDurationSeconds: 200,
  trackPositionSeconds: 140,
  deckDurationSeconds: 199.9,
  deckPositionSeconds: 140,
};

describe("remainingForCue", () => {
  it("reports what the track has left", () => {
    expect(remainingForCue(wholeTrack)).toBeCloseTo(60, 10);
  });

  it("is unchanged by a deck that matches the track, which is every deck today", () => {
    expect(remainingForCue(wholeTrack)).toBeCloseTo(60, 10);
    expect(remainingForCue({ ...wholeTrack, deckDurationSeconds: 200 })).toBeCloseTo(60, 10);
  });

  it("says nothing when the track's clock is unreadable, rather than guessing from the deck", () => {
    const noClock = { ...wholeTrack, trackDurationSeconds: Number.NaN };
    expect(remainingForCue(noClock)).toBeNaN();
  });

  describe("edge cases", () => {
    it("reports zero rather than negative at the end of a track", () => {
      expect(remainingForCue({ ...wholeTrack, trackPositionSeconds: 260 })).toBe(0);
    });

    it("reports NaN when neither clock is usable", () => {
      const blind: CueClockInput = {
        trackDurationSeconds: Number.NaN,
        trackPositionSeconds: Number.NaN,
        deckDurationSeconds: Number.NaN,
        deckPositionSeconds: Number.NaN,
      };
      expect(remainingForCue(blind)).toBeNaN();
    });

    it("treats a zero-length track as unreadable", () => {
      expect(remainingForCue({ ...wholeTrack, trackDurationSeconds: 0 })).toBeNaN();
    });

    it("treats a NaN deck position as unreadable, which is what a stopped deck reports", () => {
      const stopped = { ...wholeTrack, trackDurationSeconds: Number.NaN, deckPositionSeconds: Number.NaN };
      expect(remainingForCue(stopped)).toBeNaN();
    });

    it("still answers from the track while the deck is stopped", () => {
      expect(remainingForCue({ ...wholeTrack, deckPositionSeconds: Number.NaN })).toBeCloseTo(60, 10);
    });
  });

  describe("invariants", () => {
    it("is never negative", () => {
      for (const trackPositionSeconds of [0, 100, 200, 500]) {
        const answer = remainingForCue({ ...wholeTrack, trackPositionSeconds });
        if (Number.isNaN(answer)) continue;
        expect(answer).toBeGreaterThanOrEqual(0);
      }
    });

    it("never shortens because the deck is short, which is the whole point", () => {
      for (const deckDurationSeconds of [1, 13, 60, 199.9]) {
        expect(remainingForCue({ ...wholeTrack, deckDurationSeconds })).toBeCloseTo(60, 10);
      }
    });
  });

  describe("regressions", () => {
    it("regression: a 13 s deck 5 s into a 200 s track has 195 s left, not 8", () => {
      const shortDeck: CueClockInput = {
        trackDurationSeconds: 200,
        trackPositionSeconds: 5,
        deckDurationSeconds: 13,
        deckPositionSeconds: 5,
      };
      expect(remainingForCue(shortDeck)).toBeCloseTo(195, 10);
    });

    it("regression: stems covering 0.9 of the track never make the cue think the track is ending", () => {
      const nearlySpentDeck: CueClockInput = {
        trackDurationSeconds: Number.NaN,
        trackPositionSeconds: 190,
        deckDurationSeconds: 198,
        deckPositionSeconds: 190,
      };
      expect(remainingForCue(nearlySpentDeck)).toBeNaN();
    });
  });
});

describe("fadeCeilingSeconds", () => {
  it("reports what the outgoing deck can still play", () => {
    expect(fadeCeilingSeconds(wholeTrack)).toBeCloseTo(59.9, 10);
  });

  it("reports the deck's shortfall, not the track's, so a fade cannot outlast the audio", () => {
    const shortDeck = { ...wholeTrack, deckDurationSeconds: 143, deckPositionSeconds: 140 };
    expect(fadeCeilingSeconds(shortDeck)).toBeCloseTo(3, 10);
  });

  describe("edge cases", () => {
    it("reports NaN for a stopped deck, so the caller falls back rather than clamping to nothing", () => {
      expect(fadeCeilingSeconds({ ...wholeTrack, deckPositionSeconds: Number.NaN })).toBeNaN();
    });

    it("reports zero at the exact end of the buffer", () => {
      expect(fadeCeilingSeconds({ ...wholeTrack, deckPositionSeconds: 199.9 })).toBe(0);
    });
  });

  describe("invariants", () => {
    it("ignores the track entirely", () => {
      for (const trackDurationSeconds of [10, 200, 10_000]) {
        expect(fadeCeilingSeconds({ ...wholeTrack, trackDurationSeconds })).toBeCloseTo(59.9, 10);
      }
    });
  });
});
