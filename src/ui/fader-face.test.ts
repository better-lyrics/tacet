import { describe, expect, it } from "vitest";
import type { KaraokeStatus } from "@/orchestrator/karaoke-state";
import { separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationMode } from "@/settings/separation-mode";
import { ASKING_LABEL, describeAskingFader, faderFace } from "@/ui/fader-face";

const MODES: SeparationMode[] = ["off", "on-demand", "every-track"];

const STATUSES: (KaraokeStatus | null)[] = [
  null,
  "waiting-for-capture",
  "ready-to-engage",
  "processing",
  "engaged",
  "failed",
];

const UNTOUCHED: KaraokeStatus = "waiting-for-capture";

describe("faderFace", () => {
  it("asks the listener to tap while nothing has asked for this track", () => {
    expect(faderFace({ mode: "on-demand", armed: false, status: UNTOUCHED })).toBe("asking");
  });

  it("shows the karaoke state the moment the listener taps", () => {
    expect(faderFace({ mode: "on-demand", armed: true, status: UNTOUCHED })).toBe("karaoke-state");
  });

  it("shows the karaoke state throughout a mode that separates every track", () => {
    expect(faderFace({ mode: "every-track", armed: false, status: UNTOUCHED })).toBe("karaoke-state");
    expect(faderFace({ mode: "every-track", armed: true, status: "engaged" })).toBe("karaoke-state");
  });

  it("stays inert while separation is off", () => {
    expect(faderFace({ mode: "off", armed: false, status: UNTOUCHED })).toBe("inert");
  });

  describe("edge cases", () => {
    it("keeps the inert face even when the fader is somehow still pulled down", () => {
      expect(faderFace({ mode: "off", armed: true, status: "engaged" })).toBe("inert");
    });

    it("asks when there is no pipeline to report a status at all", () => {
      expect(faderFace({ mode: "on-demand", armed: false, status: null })).toBe("asking");
    });

    it("keeps reporting a failure rather than asking over the top of it", () => {
      expect(faderFace({ mode: "on-demand", armed: false, status: "failed" })).toBe("karaoke-state");
    });
  });

  describe("invariants", () => {
    it("asks only when the veto says nothing asked for this track", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const status of STATUSES) {
            const veto = separationVeto({ mode, faderArmed: armed, role: "current" });
            if (faderFace({ mode, armed, status }) === "asking") {
              expect(veto).toBe("nothing-asked-for-it");
            }
          }
        }
      }
    });

    it("goes inert exactly when the veto blames the setting rather than the fader", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const status of STATUSES) {
            const veto = separationVeto({ mode, faderArmed: armed, role: "current" });
            expect(faderFace({ mode, armed, status }) === "inert").toBe(veto === "sing-along-off");
          }
        }
      }
    });

    it("shows the karaoke state whenever the track may be separated", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const status of STATUSES) {
            if (separationVeto({ mode, faderArmed: armed, role: "current" }) !== null) continue;
            expect(faderFace({ mode, armed, status })).toBe("karaoke-state");
          }
        }
      }
    });

    it("answers with one of the three faces for every combination", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const status of STATUSES) {
            expect(["inert", "asking", "karaoke-state"]).toContain(faderFace({ mode, armed, status }));
          }
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: the button does not report work that is not happening", () => {
      expect(faderFace({ mode: "on-demand", armed: false, status: UNTOUCHED })).not.toBe("karaoke-state");
    });

    it("regression: sing-along being off still wins over asking", () => {
      expect(faderFace({ mode: "off", armed: false, status: UNTOUCHED })).toBe("inert");
    });

    it("regression: a track already separated is not offered for separation again", () => {
      for (const status of ["ready-to-engage", "processing", "engaged"] as KaraokeStatus[]) {
        expect(faderFace({ mode: "on-demand", armed: false, status })).toBe("karaoke-state");
      }
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
