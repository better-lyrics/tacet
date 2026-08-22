import { type DeadPanelInput, deadPanelReason } from "@/settings/dead-panels";
import { POPUP_TABS, type PopupTab } from "@/settings/popup-tabs";
import { SEPARATION_MODES } from "@/settings/separation-mode";
import { CROSSFADE_PRESETS_SECONDS } from "@/settings/settings";
import { describe, expect, it } from "vitest";

const ALWAYS_LIVE: readonly PopupTab[] = ["general", "storage"];

function every(check: (input: DeadPanelInput) => void): void {
  for (const mode of SEPARATION_MODES) {
    for (const crossfadeSeconds of CROSSFADE_PRESETS_SECONDS) {
      check({ mode, crossfadeSeconds });
    }
  }
}

describe("deadPanelReason", () => {
  // -- happy path ---------------------------------------------------------------

  describe("happy path", () => {
    it("kills the separation panel while sing-along is off", () => {
      expect(deadPanelReason("separation", { mode: "off", crossfadeSeconds: 8 })).toBe(
        "Sing-along is off, so these do nothing."
      );
    });

    it("leaves the separation panel alone in every mode that separates", () => {
      expect(deadPanelReason("separation", { mode: "on-demand", crossfadeSeconds: 0 })).toBeNull();
      expect(deadPanelReason("separation", { mode: "every-track", crossfadeSeconds: 0 })).toBeNull();
    });

    it("kills the sources panel only when nothing fetches a track at all", () => {
      expect(deadPanelReason("sources", { mode: "off", crossfadeSeconds: 0 })).toBe(
        "Sing-along and crossfade are both off, so no track is fetched."
      );
    });

    it("keeps the sources panel while a crossfade still fetches the track ahead", () => {
      expect(deadPanelReason("sources", { mode: "off", crossfadeSeconds: 8 })).toBeNull();
    });

    it("keeps the sources panel while separation still fetches the track playing", () => {
      expect(deadPanelReason("sources", { mode: "on-demand", crossfadeSeconds: 0 })).toBeNull();
      expect(deadPanelReason("sources", { mode: "every-track", crossfadeSeconds: 0 })).toBeNull();
    });
  });

  // -- edge cases ---------------------------------------------------------------

  describe("edge cases", () => {
    it("answers for every tab in every mode", () => {
      for (const tab of POPUP_TABS) {
        for (const mode of SEPARATION_MODES) {
          const reason = deadPanelReason(tab, { mode, crossfadeSeconds: 8 });
          expect(reason === null || reason.length > 0).toBe(true);
        }
      }
    });

    it("puts the sources boundary at a crossfade of zero", () => {
      expect(deadPanelReason("sources", { mode: "off", crossfadeSeconds: 0 })).not.toBeNull();
      for (const seconds of CROSSFADE_PRESETS_SECONDS.filter(preset => preset > 0)) {
        expect(deadPanelReason("sources", { mode: "off", crossfadeSeconds: seconds })).toBeNull();
      }
    });

    it("reads a crossfade shorter than any preset as a live crossfade", () => {
      expect(deadPanelReason("sources", { mode: "off", crossfadeSeconds: 0.5 })).toBeNull();
    });

    it("ignores the crossfade length entirely when judging the separation panel", () => {
      for (const seconds of CROSSFADE_PRESETS_SECONDS) {
        expect(deadPanelReason("separation", { mode: "off", crossfadeSeconds: seconds })).not.toBeNull();
        expect(deadPanelReason("separation", { mode: "on-demand", crossfadeSeconds: seconds })).toBeNull();
      }
    });
  });

  // -- invariants ---------------------------------------------------------------

  describe("invariants", () => {
    it("never kills general or storage, in any combination", () => {
      every(input => {
        for (const tab of ALWAYS_LIVE) expect(deadPanelReason(tab, input)).toBeNull();
      });
    });

    it("gives every dead panel a reason worth reading", () => {
      every(input => {
        for (const tab of POPUP_TABS) {
          const reason = deadPanelReason(tab, input);
          if (reason === null) continue;
          expect(reason.trim().length).toBeGreaterThan(0);
          expect(reason.endsWith(".")).toBe(true);
        }
      });
    });

    it("a dead sources panel means a dead separation panel, never the other way round", () => {
      every(input => {
        if (deadPanelReason("sources", input) === null) return;
        expect(deadPanelReason("separation", input)).not.toBeNull();
      });
    });

    it("leaves every panel alive whenever separation is on", () => {
      every(input => {
        if (input.mode === "off") return;
        for (const tab of POPUP_TABS) expect(deadPanelReason(tab, input)).toBeNull();
      });
    });

    it("reads the same answer however many times it is asked", () => {
      every(input => {
        for (const tab of POPUP_TABS) {
          expect(deadPanelReason(tab, input)).toBe(deadPanelReason(tab, input));
        }
      });
    });
  });
});
