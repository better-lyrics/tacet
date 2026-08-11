import { RESTART_DRIFT_TOLERANCE_S, shouldRestartStems } from "@/pageworld/stem-restart";
import { describe, expect, it } from "vitest";

const playing = { hasActiveSources: true, stemPositionSeconds: 10, playerPositionSeconds: 10 };

describe("shouldRestartStems", () => {
  it("starts when nothing is playing yet", () => {
    expect(shouldRestartStems({ ...playing, hasActiveSources: false })).toBe(true);
  });

  it("leaves aligned stems alone", () => {
    expect(shouldRestartStems(playing)).toBe(false);
  });

  it("leaves stems alone for drift inside the tolerance", () => {
    expect(shouldRestartStems({ ...playing, playerPositionSeconds: 10 + RESTART_DRIFT_TOLERANCE_S / 2 })).toBe(false);
    expect(shouldRestartStems({ ...playing, playerPositionSeconds: 10 - RESTART_DRIFT_TOLERANCE_S / 2 })).toBe(false);
  });

  it("restarts after a seek forward", () => {
    expect(shouldRestartStems({ ...playing, playerPositionSeconds: 45 })).toBe(true);
  });

  it("restarts after a seek backward", () => {
    expect(shouldRestartStems({ ...playing, playerPositionSeconds: 2 })).toBe(true);
  });

  describe("regressions", () => {
    it("regression: a second transport event at the same position does not restart", () => {
      expect(shouldRestartStems(playing)).toBe(false);
    });

    it("regression: stems that advanced with the track are not restarted", () => {
      expect(
        shouldRestartStems({ hasActiveSources: true, stemPositionSeconds: 2.02, playerPositionSeconds: 2.03 })
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("restarts when either position is not a number", () => {
      expect(shouldRestartStems({ ...playing, stemPositionSeconds: Number.NaN })).toBe(true);
      expect(shouldRestartStems({ ...playing, playerPositionSeconds: Number.NaN })).toBe(true);
      expect(shouldRestartStems({ ...playing, stemPositionSeconds: Number.POSITIVE_INFINITY })).toBe(true);
    });

    it("treats drift exactly at the tolerance as acceptable", () => {
      expect(shouldRestartStems({ ...playing, playerPositionSeconds: 10 + RESTART_DRIFT_TOLERANCE_S })).toBe(false);
    });

    it("restarts just past the tolerance", () => {
      expect(shouldRestartStems({ ...playing, playerPositionSeconds: 10 + RESTART_DRIFT_TOLERANCE_S + 0.001 })).toBe(
        true
      );
    });

    it("honours an explicit tolerance", () => {
      expect(shouldRestartStems({ ...playing, playerPositionSeconds: 11, toleranceSeconds: 2 })).toBe(false);
      expect(shouldRestartStems({ ...playing, playerPositionSeconds: 11, toleranceSeconds: 0.5 })).toBe(true);
    });

    it("handles the very start of a track", () => {
      expect(shouldRestartStems({ hasActiveSources: true, stemPositionSeconds: 0, playerPositionSeconds: 0 })).toBe(
        false
      );
    });
  });

  describe("invariants", () => {
    it("is symmetric in the direction of drift", () => {
      for (const delta of [0.05, 0.2, 5]) {
        const forward = shouldRestartStems({ ...playing, playerPositionSeconds: 10 + delta });
        const backward = shouldRestartStems({ ...playing, playerPositionSeconds: 10 - delta });
        expect(forward).toBe(backward);
      }
    });

    it("always starts when there are no sources, whatever the positions", () => {
      for (const player of [0, 10, 1000, Number.NaN]) {
        expect(
          shouldRestartStems({ hasActiveSources: false, stemPositionSeconds: 10, playerPositionSeconds: player })
        ).toBe(true);
      }
    });

    it("keeps the tolerance small enough to stay inaudible as a resync", () => {
      expect(RESTART_DRIFT_TOLERANCE_S).toBeGreaterThan(0);
      expect(RESTART_DRIFT_TOLERANCE_S).toBeLessThanOrEqual(0.25);
    });
  });
});
