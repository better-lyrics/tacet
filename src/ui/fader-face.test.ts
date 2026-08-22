import { describe, expect, it } from "vitest";
import { separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationMode } from "@/settings/separation-mode";
import { ASKING_LABEL, describeAskingFader, faderFace } from "@/ui/fader-face";

const MODES: SeparationMode[] = ["off", "on-demand", "every-track"];

describe("faderFace", () => {
  it("asks the listener to tap while nothing has asked for this track", () => {
    expect(faderFace({ mode: "on-demand", armed: false })).toBe("asking");
  });

  it("shows the karaoke state the moment the listener taps", () => {
    expect(faderFace({ mode: "on-demand", armed: true })).toBe("karaoke-state");
  });

  it("shows the karaoke state throughout a mode that separates every track", () => {
    expect(faderFace({ mode: "every-track", armed: false })).toBe("karaoke-state");
    expect(faderFace({ mode: "every-track", armed: true })).toBe("karaoke-state");
  });

  it("stays inert while separation is off", () => {
    expect(faderFace({ mode: "off", armed: false })).toBe("inert");
  });

  describe("edge cases", () => {
    it("keeps the inert face even when the fader is somehow still pulled down", () => {
      expect(faderFace({ mode: "off", armed: true })).toBe("inert");
    });
  });

  describe("invariants", () => {
    it("asks exactly when the veto says nothing asked for this track", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          const veto = separationVeto({ mode, faderArmed: armed, role: "current" });
          expect(faderFace({ mode, armed }) === "asking").toBe(veto === "nothing-asked-for-it");
        }
      }
    });

    it("goes inert exactly when the veto blames the setting rather than the fader", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          const veto = separationVeto({ mode, faderArmed: armed, role: "current" });
          expect(faderFace({ mode, armed }) === "inert").toBe(veto === "sing-along-off");
        }
      }
    });

    it("shows the karaoke state exactly when the track may be separated", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          const wanted = separationVeto({ mode, faderArmed: armed, role: "current" }) === null;
          expect(faderFace({ mode, armed }) === "karaoke-state").toBe(wanted);
        }
      }
    });

    it("answers with one of the three faces for every mode", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          expect(["inert", "asking", "karaoke-state"]).toContain(faderFace({ mode, armed }));
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: the button does not report work that is not happening", () => {
      expect(faderFace({ mode: "on-demand", armed: false })).not.toBe("karaoke-state");
    });

    it("regression: sing-along being off still wins over asking", () => {
      expect(faderFace({ mode: "off", armed: false })).toBe("inert");
    });
  });
});

describe("describeAskingFader", () => {
  it("tells the listener what tapping the button does", () => {
    expect(describeAskingFader()).toEqual({ label: ASKING_LABEL, percent: null });
  });

  it("carries no progress, because nothing is being measured", () => {
    expect(describeAskingFader().percent).toBeNull();
  });
});
