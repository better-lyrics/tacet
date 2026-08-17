import { describe, expect, it } from "vitest";
import { separationWanted } from "@/orchestrator/separation-wanted";
import type { SeparationWantedInput } from "@/orchestrator/separation-wanted";

function input(overrides: Partial<SeparationWantedInput> = {}): SeparationWantedInput {
  return { singAlongEnabled: true, autoSeparateEnabled: true, faderArmed: false, ...overrides };
}

describe("separationWanted", () => {
  it("separates when the listener asked for it to happen automatically", () => {
    expect(separationWanted(input())).toBe(true);
  });

  it("separates when the fader is armed even though automatic separation is off", () => {
    expect(separationWanted(input({ autoSeparateEnabled: false, faderArmed: true }))).toBe(true);
  });

  it("does not separate when automatic separation is off and the fader is neutral", () => {
    expect(separationWanted(input({ autoSeparateEnabled: false, faderArmed: false }))).toBe(false);
  });

  describe("edge cases", () => {
    it("never separates with sing-along off, whatever else is set", () => {
      for (const autoSeparateEnabled of [true, false]) {
        for (const faderArmed of [true, false]) {
          expect(separationWanted(input({ singAlongEnabled: false, autoSeparateEnabled, faderArmed }))).toBe(false);
        }
      }
    });
  });

  describe("invariants", () => {
    it("is a pure decision, since every gate asks it again on the next track", () => {
      const asked = input({ faderArmed: true });
      expect(separationWanted(asked)).toBe(separationWanted(asked));
    });

    it("sing-along off is the only input that can veto on its own", () => {
      expect(separationWanted(input({ singAlongEnabled: false }))).toBe(false);
      expect(separationWanted(input({ autoSeparateEnabled: false }))).toBe(false);
      expect(separationWanted(input({ autoSeparateEnabled: false, faderArmed: true }))).toBe(true);
    });
  });

  describe("regressions", () => {
    it("regression: crossfade alone never sends a track off to be separated", () => {
      expect(separationWanted(input({ singAlongEnabled: false, autoSeparateEnabled: true }))).toBe(false);
    });
  });
});
