import { describe, expect, it } from "vitest";
import { describeSeparationVeto, separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationVeto, SeparationWantedInput } from "@/orchestrator/separation-wanted";

function input(overrides: Partial<SeparationWantedInput> = {}): SeparationWantedInput {
  return { singAlongEnabled: true, autoSeparateEnabled: true, faderArmed: false, ...overrides };
}

const EVERY_COMBINATION: [boolean, boolean, boolean, SeparationVeto | null][] = [
  [true, true, true, null],
  [true, true, false, null],
  [true, false, true, null],
  [true, false, false, "nothing-asked-for-it"],
  [false, true, true, "sing-along-off"],
  [false, true, false, "sing-along-off"],
  [false, false, true, "sing-along-off"],
  [false, false, false, "sing-along-off"],
];

describe("separationVeto", () => {
  it.each(EVERY_COMBINATION)(
    "sing-along=%s auto-separate=%s fader-armed=%s vetoes with %s",
    (singAlongEnabled, autoSeparateEnabled, faderArmed, expected) => {
      expect(separationVeto({ singAlongEnabled, autoSeparateEnabled, faderArmed })).toBe(expected);
    }
  );

  describe("invariants", () => {
    it("sing-along off is the only input that can veto on its own", () => {
      expect(separationVeto(input({ singAlongEnabled: false, faderArmed: true }))).toBe("sing-along-off");
      expect(separationVeto(input({ autoSeparateEnabled: false, faderArmed: true }))).toBeNull();
      expect(separationVeto(input({ autoSeparateEnabled: true, faderArmed: false }))).toBeNull();
    });
  });

  describe("regressions", () => {
    it("regression: crossfade alone never sends a track off to be separated", () => {
      expect(separationVeto(input({ singAlongEnabled: false, autoSeparateEnabled: true }))).toBe("sing-along-off");
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
