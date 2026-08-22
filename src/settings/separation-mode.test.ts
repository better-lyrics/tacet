import {
  SEPARATION_MODES,
  SEPARATION_MODE_OPTIONS,
  isSeparationMode,
  separatesEveryTrack,
  separationIsOff,
  separationModeFromLegacy,
  settlesEachTrack,
} from "@/settings/separation-mode";
import { describe, expect, it } from "vitest";

// -- happy path ----------------------------------------------------------------

describe("isSeparationMode", () => {
  it("accepts every registered mode", () => {
    for (const mode of SEPARATION_MODES) expect(isSeparationMode(mode)).toBe(true);
  });

  it("rejects a name that is not a mode", () => {
    expect(isSeparationMode("on")).toBe(false);
  });
});

describe("SEPARATION_MODE_OPTIONS", () => {
  it("offers every mode exactly once, in the order they are registered", () => {
    expect(SEPARATION_MODE_OPTIONS.map(option => option.value)).toEqual([...SEPARATION_MODES]);
  });

  it("gives every row a label and a note", () => {
    for (const option of SEPARATION_MODE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.note.length).toBeGreaterThan(0);
    }
  });
});

describe("separationModeFromLegacy", () => {
  it("reads sing-along off as off", () => {
    expect(separationModeFromLegacy(false, true)).toBe("off");
    expect(separationModeFromLegacy(false, false)).toBe("off");
  });

  it("reads auto-separate off as on demand", () => {
    expect(separationModeFromLegacy(true, false)).toBe("on-demand");
  });

  it("reads both on as every track", () => {
    expect(separationModeFromLegacy(true, true)).toBe("every-track");
  });
});

// -- the fader rule --------------------------------------------------------------

describe("settlesEachTrack", () => {
  it("settles in on demand, where the button is an action", () => {
    expect(settlesEachTrack("on-demand")).toBe(true);
  });

  it("holds in every track, where the button is a level", () => {
    expect(settlesEachTrack("every-track")).toBe(false);
  });

  it("does not ask the inert mode to settle on a track change", () => {
    expect(settlesEachTrack("off")).toBe(false);
  });
});

describe("separationIsOff", () => {
  it("is only true for the mode that separates nothing", () => {
    expect(separationIsOff("off")).toBe(true);
    expect(separationIsOff("on-demand")).toBe(false);
    expect(separationIsOff("every-track")).toBe(false);
  });
});

describe("separatesEveryTrack", () => {
  it("is only true for the every-track mode", () => {
    expect(separatesEveryTrack("every-track")).toBe(true);
    expect(separatesEveryTrack("on-demand")).toBe(false);
    expect(separatesEveryTrack("off")).toBe(false);
  });
});

// -- invariants ------------------------------------------------------------------

describe("invariants", () => {
  it("the mode that settles per track is never the mode that separates every track", () => {
    for (const mode of SEPARATION_MODES) {
      expect(settlesEachTrack(mode) && separatesEveryTrack(mode)).toBe(false);
    }
  });

  it("every legacy pair maps onto a registered mode", () => {
    for (const singAlong of [true, false]) {
      for (const autoSeparate of [true, false]) {
        expect(SEPARATION_MODES).toContain(separationModeFromLegacy(singAlong, autoSeparate));
      }
    }
  });
});
