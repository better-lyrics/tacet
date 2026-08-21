import { describe, expect, it } from "vitest";
import { isFaderInteractive, shouldCloseForDisabled, shouldSettleToNeutral } from "@/ui/fader-disabled-gate";

describe("isFaderInteractive", () => {
  it("is interactive when not disabled", () => {
    expect(isFaderInteractive(false, true)).toBe(true);
  });

  it("refuses to act while disabled", () => {
    expect(isFaderInteractive(true, true)).toBe(false);
  });

  it("refuses to act while the control is inert", () => {
    expect(isFaderInteractive(false, false)).toBe(false);
  });

  describe("edge cases", () => {
    it("stays refused when both reasons hold at once", () => {
      expect(isFaderInteractive(true, false)).toBe(false);
    });
  });

  describe("invariants", () => {
    it("takes both reasons, so neither one alone can let an input through", () => {
      const refused = [
        isFaderInteractive(true, true),
        isFaderInteractive(false, false),
        isFaderInteractive(true, false),
      ];
      expect(refused).toEqual([false, false, false]);
    });
  });
});

describe("shouldCloseForDisabled", () => {
  it("closes an open card the instant the control goes disabled", () => {
    expect(shouldCloseForDisabled(true, true)).toBe(true);
  });

  describe("edge cases", () => {
    it("does nothing to a closed card that goes disabled", () => {
      expect(shouldCloseForDisabled(false, true)).toBe(false);
    });

    it("does nothing to an open card that stays enabled", () => {
      expect(shouldCloseForDisabled(true, false)).toBe(false);
    });

    it("does nothing when neither open nor disabled", () => {
      expect(shouldCloseForDisabled(false, false)).toBe(false);
    });
  });
});

describe("shouldSettleToNeutral", () => {
  it("settles a fader that goes inert while it still asks for the vocals to be removed", () => {
    expect(shouldSettleToNeutral(false, -1)).toBe(true);
  });

  it("leaves an interactive fader alone", () => {
    expect(shouldSettleToNeutral(true, -1)).toBe(false);
  });

  describe("edge cases", () => {
    it("says nothing to settle when the fader is already neutral", () => {
      expect(shouldSettleToNeutral(false, 0)).toBe(false);
    });

    it("settles a partially pulled fader, not only a fully pulled one", () => {
      expect(shouldSettleToNeutral(false, -0.4)).toBe(true);
    });

    it("settles a fader pushed the other way", () => {
      expect(shouldSettleToNeutral(false, 0.5)).toBe(true);
    });

    it("treats negative zero as neutral, since it is the same level", () => {
      expect(shouldSettleToNeutral(false, -0)).toBe(false);
    });
  });

  describe("invariants", () => {
    it("never asks an interactive fader to move, whatever it is set to", () => {
      for (const value of [-1, -0.5, 0, 0.5, 1]) {
        expect(shouldSettleToNeutral(true, value)).toBe(false);
      }
    });

    it("is idempotent, since applying the settle leaves nothing more to do", () => {
      expect(shouldSettleToNeutral(false, -1)).toBe(true);
      expect(shouldSettleToNeutral(false, 0)).toBe(false);
    });
  });

  describe("regressions", () => {
    it("regression: switching sing-along off clears a fader left asking for karaoke", () => {
      expect(shouldSettleToNeutral(false, -1)).toBe(true);
    });
  });
});
