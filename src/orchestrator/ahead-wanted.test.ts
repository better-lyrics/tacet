import { describe, expect, it } from "vitest";
import { wantsAheadTrack } from "@/orchestrator/ahead-wanted";
import { SEPARATION_MODES } from "@/settings/separation-mode";
import type { SeparationMode } from "@/settings/separation-mode";

describe("wantsAheadTrack", () => {
  it("wants it when a crossfade is set, whatever the separation mode is", () => {
    for (const mode of SEPARATION_MODES) expect(wantsAheadTrack({ mode, crossfadeSeconds: 8 })).toBe(true);
  });

  it("wants it when every track is separated ahead of time, with no crossfade at all", () => {
    expect(wantsAheadTrack({ mode: "every-track", crossfadeSeconds: 0 })).toBe(true);
  });

  it("does not want it when nothing would fade into it or separate it", () => {
    expect(wantsAheadTrack({ mode: "on-demand", crossfadeSeconds: 0 })).toBe(false);
    expect(wantsAheadTrack({ mode: "off", crossfadeSeconds: 0 })).toBe(false);
  });

  describe("every combination of the two settings", () => {
    const expected: Record<SeparationMode, Record<"none" | "some", boolean>> = {
      off: { none: false, some: true },
      "on-demand": { none: false, some: true },
      "every-track": { none: true, some: true },
    };

    it.each(SEPARATION_MODES)("answers for %s with and without a crossfade", mode => {
      expect(wantsAheadTrack({ mode, crossfadeSeconds: 0 })).toBe(expected[mode].none);
      expect(wantsAheadTrack({ mode, crossfadeSeconds: 8 })).toBe(expected[mode].some);
    });
  });

  describe("edge cases", () => {
    it("treats a crossfade of zero as no crossfade rather than as a short one", () => {
      expect(wantsAheadTrack({ mode: "on-demand", crossfadeSeconds: 0 })).toBe(false);
      expect(wantsAheadTrack({ mode: "on-demand", crossfadeSeconds: 0.5 })).toBe(true);
    });

    it("refuses an unreadable crossfade rather than reading it as a fade", () => {
      expect(wantsAheadTrack({ mode: "on-demand", crossfadeSeconds: Number.NaN })).toBe(false);
      expect(wantsAheadTrack({ mode: "on-demand", crossfadeSeconds: -1 })).toBe(false);
    });

    it("still wants it for every-track even when the crossfade is unreadable", () => {
      expect(wantsAheadTrack({ mode: "every-track", crossfadeSeconds: Number.NaN })).toBe(true);
    });
  });

  describe("invariants", () => {
    it("lengthening a crossfade never takes the want away", () => {
      for (const mode of SEPARATION_MODES) {
        for (const seconds of [0, 2, 8, 20]) {
          if (!wantsAheadTrack({ mode, crossfadeSeconds: seconds })) continue;
          expect(wantsAheadTrack({ mode, crossfadeSeconds: seconds + 1 })).toBe(true);
        }
      }
    });

    it("answers the same however many times it is asked, since nothing is stored", () => {
      for (const mode of SEPARATION_MODES) {
        const first = wantsAheadTrack({ mode, crossfadeSeconds: 4 });
        expect(wantsAheadTrack({ mode, crossfadeSeconds: 4 })).toBe(first);
      }
    });
  });

  describe("regressions", () => {
    it("regression: on-demand with no crossfade fetches nothing ahead, so no frame is spawned for a track nobody wants", () => {
      expect(wantsAheadTrack({ mode: "on-demand", crossfadeSeconds: 0 })).toBe(false);
    });

    it("regression: sing-along off with a crossfade still warms the next track, because the fade needs its audio", () => {
      expect(wantsAheadTrack({ mode: "off", crossfadeSeconds: 8 })).toBe(true);
    });
  });
});
