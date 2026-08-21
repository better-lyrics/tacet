import { describe, expect, it } from "vitest";
import { describeSeparationVeto, separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationVeto, SeparationWantedInput } from "@/orchestrator/separation-wanted";
import type { SeparationMode } from "@/settings/separation-mode";

function input(overrides: Partial<SeparationWantedInput> = {}): SeparationWantedInput {
  return { mode: "every-track", faderArmed: false, ...overrides };
}

const EVERY_COMBINATION: [SeparationMode, boolean, SeparationVeto | null][] = [
  ["every-track", true, null],
  ["every-track", false, null],
  ["on-demand", true, null],
  ["on-demand", false, "nothing-asked-for-it"],
  ["off", true, "sing-along-off"],
  ["off", false, "sing-along-off"],
];

describe("separationVeto", () => {
  it.each(EVERY_COMBINATION)("mode=%s fader-armed=%s vetoes with %s", (mode, faderArmed, expected) => {
    expect(separationVeto({ mode, faderArmed })).toBe(expected);
  });

  describe("invariants", () => {
    it("off is the only mode that can veto on its own", () => {
      expect(separationVeto(input({ mode: "off", faderArmed: true }))).toBe("sing-along-off");
      expect(separationVeto(input({ mode: "on-demand", faderArmed: true }))).toBeNull();
      expect(separationVeto(input({ mode: "every-track", faderArmed: false }))).toBeNull();
    });

    it("a mode that separates every track never waits for the fader", () => {
      for (const faderArmed of [true, false]) {
        expect(separationVeto(input({ mode: "every-track", faderArmed }))).toBeNull();
      }
    });
  });

  describe("regressions", () => {
    it("regression: crossfade alone never sends a track off to be separated", () => {
      expect(separationVeto(input({ mode: "off" }))).toBe("sing-along-off");
    });
  });
});

describe("describeSeparationVeto", () => {
  it("blames sing-along rather than the fader when sing-along is off", () => {
    expect(describeSeparationVeto("sing-along-off")).toBe("sing-along is off");
  });

  it("names both the setting and the fader when neither asked for it", () => {
    expect(describeSeparationVeto("nothing-asked-for-it")).toBe("separation is off and the fader is neutral");
  });
});
