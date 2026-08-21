import { describe, expect, it } from "vitest";
import { describeSeparationVeto, separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationRole, SeparationVeto, SeparationWantedInput } from "@/orchestrator/separation-wanted";
import type { SeparationMode } from "@/settings/separation-mode";

function input(overrides: Partial<SeparationWantedInput> = {}): SeparationWantedInput {
  return { mode: "every-track", faderArmed: false, role: "current", ...overrides };
}

const EVERY_COMBINATION: [SeparationMode, boolean, SeparationRole, SeparationVeto | null][] = [
  ["every-track", true, "current", null],
  ["every-track", true, "ahead", null],
  ["every-track", false, "current", null],
  ["every-track", false, "ahead", null],
  ["on-demand", true, "current", null],
  ["on-demand", true, "ahead", "nothing-asked-for-it"],
  ["on-demand", false, "current", "nothing-asked-for-it"],
  ["on-demand", false, "ahead", "nothing-asked-for-it"],
  ["off", true, "current", "sing-along-off"],
  ["off", true, "ahead", "sing-along-off"],
  ["off", false, "current", "sing-along-off"],
  ["off", false, "ahead", "sing-along-off"],
];

describe("separationVeto", () => {
  it.each(EVERY_COMBINATION)("mode=%s fader-armed=%s role=%s vetoes with %s", (mode, faderArmed, role, expected) => {
    expect(separationVeto({ mode, faderArmed, role })).toBe(expected);
  });

  describe("invariants", () => {
    it("off is the only mode that can veto on its own", () => {
      expect(separationVeto(input({ mode: "off", faderArmed: true }))).toBe("sing-along-off");
      expect(separationVeto(input({ mode: "on-demand", faderArmed: true }))).toBeNull();
      expect(separationVeto(input({ mode: "every-track", faderArmed: false }))).toBeNull();
    });

    it("a mode that separates every track never waits for the fader", () => {
      for (const faderArmed of [true, false]) {
        for (const role of ["current", "ahead"] as const) {
          expect(separationVeto(input({ mode: "every-track", faderArmed, role }))).toBeNull();
        }
      }
    });

    it("the fader is the only reason a role changes the answer", () => {
      for (const mode of ["off", "every-track"] as const) {
        for (const faderArmed of [true, false]) {
          const current = separationVeto(input({ mode, faderArmed, role: "current" }));
          expect(separationVeto(input({ mode, faderArmed, role: "ahead" }))).toBe(current);
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: crossfade alone never sends a track off to be separated", () => {
      expect(separationVeto(input({ mode: "off" }))).toBe("sing-along-off");
    });

    it("regression: an armed fader in on demand does not open the ahead track", () => {
      expect(separationVeto(input({ mode: "on-demand", faderArmed: true, role: "current" }))).toBeNull();
      expect(separationVeto(input({ mode: "on-demand", faderArmed: true, role: "ahead" }))).toBe(
        "nothing-asked-for-it"
      );
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
