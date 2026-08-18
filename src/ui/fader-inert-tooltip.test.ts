import { describe, expect, it } from "vitest";
import { CROSSFADE_ONLY_LABEL, SING_ALONG_OFF_LABEL, describeInertFader } from "@/ui/fader-inert-tooltip";

describe("describeInertFader", () => {
  it("says sing-along is off and crossfade is still running", () => {
    expect(describeInertFader(8)).toEqual({ label: CROSSFADE_ONLY_LABEL, percent: null });
  });

  it("says only that sing-along is off when nothing else is running", () => {
    expect(describeInertFader(0)).toEqual({ label: SING_ALONG_OFF_LABEL, percent: null });
  });

  describe("edge cases", () => {
    it("treats the shortest fade the listener can set as running", () => {
      expect(describeInertFader(0.5).label).toBe(CROSSFADE_ONLY_LABEL);
    });

    it("treats an unreadable length as nothing running rather than claiming a fade", () => {
      expect(describeInertFader(Number.NaN).label).toBe(SING_ALONG_OFF_LABEL);
    });

    it("treats a negative length as nothing running", () => {
      expect(describeInertFader(-8).label).toBe(SING_ALONG_OFF_LABEL);
    });
  });

  describe("invariants", () => {
    it("never claims a crossfade the listener switched off", () => {
      expect(describeInertFader(0).label).not.toContain("crossfade");
    });

    it("always says sing-along is off, whatever the crossfade length", () => {
      for (const seconds of [0, 0.5, 1, 8, 12, Number.NaN, -1]) {
        expect(describeInertFader(seconds).label).toContain(SING_ALONG_OFF_LABEL);
      }
    });

    it("carries no progress, because nothing is being measured", () => {
      for (const seconds of [0, 8]) expect(describeInertFader(seconds).percent).toBeNull();
    });
  });
});
