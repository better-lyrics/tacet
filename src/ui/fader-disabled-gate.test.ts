import { describe, expect, it } from "vitest";
import { isFaderInteractive, shouldCloseForDisabled } from "@/ui/fader-disabled-gate";

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
