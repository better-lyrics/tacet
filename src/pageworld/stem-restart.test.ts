import {
  decideDriftCorrection,
  DRIFT_SEEK_LIMIT_S,
  DRIFT_SEEK_SETTLE_S,
  RESTART_DRIFT_TOLERANCE_S,
} from "@/pageworld/stem-restart";
import type { DriftInput } from "@/pageworld/stem-restart";
import { describe, expect, it } from "vitest";

const audible: DriftInput = {
  hasActiveSources: true,
  stemPositionSeconds: 10,
  playerPositionSeconds: 10,
  listenerSeeked: false,
  originalGain: 0,
};

describe("decideDriftCorrection", () => {
  it("starts the deck when nothing is playing yet", () => {
    expect(decideDriftCorrection({ ...audible, hasActiveSources: false }).kind).toBe("restart-deck");
  });

  it("leaves an aligned deck alone", () => {
    expect(decideDriftCorrection(audible).kind).toBe("hold");
  });

  it("leaves drift inside the tolerance alone", () => {
    const ahead = { ...audible, playerPositionSeconds: 10 + RESTART_DRIFT_TOLERANCE_S / 2 };
    const behind = { ...audible, playerPositionSeconds: 10 - RESTART_DRIFT_TOLERANCE_S / 2 };
    expect(decideDriftCorrection(ahead).kind).toBe("hold");
    expect(decideDriftCorrection(behind).kind).toBe("hold");
  });

  it("moves the silent player onto the audible deck", () => {
    const decision = decideDriftCorrection({ ...audible, playerPositionSeconds: 10.6 });
    expect(decision.kind).toBe("seek-player");
    if (decision.kind !== "seek-player") return;
    expect(decision.toSeconds).toBe(10);
    expect(decision.driftSeconds).toBeCloseTo(0.6, 6);
  });

  it("restarts the deck when the listener seeked, because they expect the jump", () => {
    const decision = decideDriftCorrection({ ...audible, playerPositionSeconds: 45, listenerSeeked: true });
    expect(decision.kind).toBe("restart-deck");
  });

  it("restarts the deck when the listener is hearing the original", () => {
    const decision = decideDriftCorrection({ ...audible, playerPositionSeconds: 10.6, originalGain: 1 });
    expect(decision.kind).toBe("restart-deck");
  });
});

describe("edge cases", () => {
  it("restarts when either clock is unreadable", () => {
    expect(decideDriftCorrection({ ...audible, stemPositionSeconds: Number.NaN }).kind).toBe("restart-deck");
    expect(decideDriftCorrection({ ...audible, playerPositionSeconds: Number.NaN }).kind).toBe("restart-deck");
    expect(decideDriftCorrection({ ...audible, stemPositionSeconds: Number.POSITIVE_INFINITY }).kind).toBe(
      "restart-deck"
    );
  });

  it("treats drift exactly at the tolerance as acceptable", () => {
    const at = { ...audible, playerPositionSeconds: 10 + RESTART_DRIFT_TOLERANCE_S };
    expect(decideDriftCorrection(at).kind).toBe("hold");
  });

  it("corrects just past the tolerance", () => {
    const past = { ...audible, playerPositionSeconds: 10 + RESTART_DRIFT_TOLERANCE_S + 0.001 };
    expect(decideDriftCorrection(past).kind).toBe("seek-player");
  });

  it("treats a gap exactly at the seek limit as drift", () => {
    const at = { ...audible, playerPositionSeconds: 10 + DRIFT_SEEK_LIMIT_S };
    expect(decideDriftCorrection(at).kind).toBe("seek-player");
  });

  it("honours an explicit tolerance", () => {
    expect(decideDriftCorrection({ ...audible, playerPositionSeconds: 11, toleranceSeconds: 2 }).kind).toBe("hold");
    expect(decideDriftCorrection({ ...audible, playerPositionSeconds: 11, toleranceSeconds: 0.5 }).kind).toBe(
      "seek-player"
    );
  });

  it("honours an explicit seek limit", () => {
    const input = { ...audible, playerPositionSeconds: 13, seekLimitSeconds: 5 };
    expect(decideDriftCorrection(input).kind).toBe("seek-player");
    expect(decideDriftCorrection({ ...input, seekLimitSeconds: 1 }).kind).toBe("restart-deck");
  });

  it("handles the very start of a track", () => {
    expect(decideDriftCorrection({ ...audible, stemPositionSeconds: 0, playerPositionSeconds: 0 }).kind).toBe("hold");
  });

  it("never asks the player to seek before the start of the track", () => {
    const decision = decideDriftCorrection({ ...audible, stemPositionSeconds: 0.3, playerPositionSeconds: 0.9 });
    expect(decision.kind === "seek-player" && decision.toSeconds >= 0).toBe(true);
  });
});

describe("invariants", () => {
  it("is symmetric in the direction of drift", () => {
    for (const delta of [0.05, 0.5, 5]) {
      const forward = decideDriftCorrection({ ...audible, playerPositionSeconds: 10 + delta });
      const backward = decideDriftCorrection({ ...audible, playerPositionSeconds: 10 - delta });
      expect(forward.kind).toBe(backward.kind);
    }
  });

  it("always restarts when there are no sources, whatever the clocks say", () => {
    for (const player of [0, 10, 1000, Number.NaN]) {
      const decision = decideDriftCorrection({ ...audible, hasActiveSources: false, playerPositionSeconds: player });
      expect(decision.kind).toBe("restart-deck");
    }
  });

  it("only ever seeks the player to where the deck already is", () => {
    for (const player of [10.3, 11, 8.5, 10 + DRIFT_SEEK_LIMIT_S]) {
      const decision = decideDriftCorrection({ ...audible, playerPositionSeconds: player });
      if (decision.kind !== "seek-player") continue;
      expect(decision.toSeconds).toBe(audible.stemPositionSeconds);
    }
  });

  it("never stops an audible deck for drift alone", () => {
    for (const player of [10.2, 10.5, 11.9, 9, 8.1]) {
      const decision = decideDriftCorrection({ ...audible, playerPositionSeconds: player });
      expect(decision.kind).not.toBe("restart-deck");
    }
  });

  it("keeps the tolerance small enough to stay inaudible as a resync", () => {
    expect(RESTART_DRIFT_TOLERANCE_S).toBeGreaterThan(0);
    expect(RESTART_DRIFT_TOLERANCE_S).toBeLessThanOrEqual(0.25);
  });

  it("keeps the seek limit wider than the tolerance and narrower than a track", () => {
    expect(DRIFT_SEEK_LIMIT_S).toBeGreaterThan(RESTART_DRIFT_TOLERANCE_S);
    expect(DRIFT_SEEK_LIMIT_S).toBeLessThan(10);
  });

  it("settles for longer than a seek takes to land", () => {
    expect(DRIFT_SEEK_SETTLE_S).toBeGreaterThan(0.1);
  });
});

describe("regressions", () => {
  it("regression: a second transport event at the same position does nothing", () => {
    expect(decideDriftCorrection(audible).kind).toBe("hold");
  });

  it("regression: a deck that advanced with the track is left alone", () => {
    const decision = decideDriftCorrection({ ...audible, stemPositionSeconds: 2.02, playerPositionSeconds: 2.03 });
    expect(decision.kind).toBe("hold");
  });

  it("regression: everyday drift moves the silent element rather than restarting audible stems", () => {
    const decision = decideDriftCorrection({ ...audible, stemPositionSeconds: 61.4, playerPositionSeconds: 61.7 });
    expect(decision.kind).toBe("seek-player");
  });

  it("regression: a listener seek attributed to us does not drag them back to the deck", () => {
    const decision = decideDriftCorrection({ ...audible, stemPositionSeconds: 30, playerPositionSeconds: 120 });
    expect(decision.kind).toBe("restart-deck");
  });
});
