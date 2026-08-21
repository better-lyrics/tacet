import { describe, expect, it } from "vitest";
import type { AheadActivity } from "@/orchestrator/ahead-status";
import {
  type AheadSnapshot,
  CROSSFADE_ONLY_LABEL,
  NEXT_TRACK_PREFIX,
  SING_ALONG_OFF_LABEL,
  describeInertFader,
} from "@/ui/fader-inert-tooltip";

function ahead(
  activity: AheadActivity | null,
  fraction: number | null = null,
  cached: boolean | null = null
): AheadSnapshot {
  return { activity, fraction, cached };
}

describe("describeInertFader", () => {
  it("says only that sing-along is off when nothing else is running", () => {
    expect(describeInertFader(0, null)).toEqual({ label: SING_ALONG_OFF_LABEL, percent: null });
  });

  it("says crossfade is still on when there is no next track to report", () => {
    expect(describeInertFader(8, null)).toEqual({ label: CROSSFADE_ONLY_LABEL, percent: null });
  });

  it("reports the next track downloading, with its progress on the bar", () => {
    expect(describeInertFader(8, ahead("downloading", 0.43))).toEqual({
      label: "Up next: Downloading",
      percent: 0.43,
      note: SING_ALONG_OFF_LABEL,
    });
  });

  it("reports the next track separating, with its progress on the bar", () => {
    expect(describeInertFader(8, ahead("separating", 0.12))).toEqual({
      label: "Up next: Separating",
      percent: 0.12,
      note: SING_ALONG_OFF_LABEL,
    });
  });

  it("reports the next track ready to fade into", () => {
    expect(describeInertFader(8, ahead("ready"))).toEqual({
      label: "Up next: Ready",
      percent: null,
      note: SING_ALONG_OFF_LABEL,
    });
  });

  it("reports the next track queued", () => {
    expect(describeInertFader(8, ahead("queued")).label).toBe("Up next: Queued");
  });

  it("reports a next track that could not be had", () => {
    expect(describeInertFader(8, ahead("unavailable")).label).toBe("Up next: Unavailable");
  });

  it("reads a cache verdict that arrived before any activity", () => {
    expect(describeInertFader(8, ahead(null, null, true)).label).toBe("Up next: Ready");
    expect(describeInertFader(8, ahead(null, null, false)).label).toBe("Up next: Queued");
  });

  describe("edge cases", () => {
    it("treats the shortest fade the listener can set as running", () => {
      expect(describeInertFader(0.5, null).label).toBe(CROSSFADE_ONLY_LABEL);
    });

    it("treats an unreadable length as nothing running rather than claiming a fade", () => {
      expect(describeInertFader(Number.NaN, ahead("downloading", 0.4)).label).toBe(SING_ALONG_OFF_LABEL);
    });

    it("treats a negative length as nothing running", () => {
      expect(describeInertFader(-8, ahead("ready")).label).toBe(SING_ALONG_OFF_LABEL);
    });

    it("says crossfade is on when the next track is known but nothing is known about it", () => {
      expect(describeInertFader(8, ahead(null)).label).toBe(CROSSFADE_ONLY_LABEL);
    });

    it("drops a fraction that is not a number rather than showing NaN on the bar", () => {
      expect(describeInertFader(8, ahead("downloading", Number.NaN)).percent).toBeNull();
      expect(describeInertFader(8, ahead("separating", Number.POSITIVE_INFINITY)).percent).toBeNull();
    });

    it("clamps a fraction outside the bar", () => {
      expect(describeInertFader(8, ahead("downloading", 1.4)).percent).toBe(1);
      expect(describeInertFader(8, ahead("downloading", -0.2)).percent).toBe(0);
    });
  });

  describe("invariants", () => {
    it("never claims a crossfade the listener switched off", () => {
      for (const next of [null, ahead("downloading", 0.5), ahead("ready")]) {
        const content = describeInertFader(0, next);
        expect(content.label).toBe(SING_ALONG_OFF_LABEL);
        expect(content.note ?? null).toBeNull();
      }
    });

    it("always says sing-along is off, on the line or under it", () => {
      const snapshots: (AheadSnapshot | null)[] = [null, ahead(null), ahead("downloading", 0.3), ahead("ready")];
      for (const seconds of [0, 0.5, 8, Number.NaN, -1]) {
        for (const next of snapshots) {
          const content = describeInertFader(seconds, next);
          expect(`${content.label} ${content.note ?? ""}`).toContain(SING_ALONG_OFF_LABEL);
        }
      }
    });

    it("names every line it draws from the ahead track as the track coming next", () => {
      const snapshots = [
        ahead("queued"),
        ahead("downloading", 0.3),
        ahead("separating", 0.1),
        ahead("ready"),
        ahead("unavailable"),
      ];
      for (const next of snapshots) {
        expect(describeInertFader(8, next).label.startsWith(`${NEXT_TRACK_PREFIX}: `)).toBe(true);
      }
    });

    it("never bakes the percentage into the label as well as the bar", () => {
      expect(describeInertFader(8, ahead("downloading", 0.43)).label).not.toContain("43");
    });

    it("carries no progress when there is nothing being measured", () => {
      for (const next of [null, ahead(null), ahead("ready"), ahead("queued"), ahead("unavailable")]) {
        expect(describeInertFader(8, next).percent).toBeNull();
      }
    });
  });

  describe("regressions", () => {
    it("regression: the same fader says different things as the next track moves on", () => {
      const said = [
        describeInertFader(8, ahead("queued")),
        describeInertFader(8, ahead("downloading", 0.2)),
        describeInertFader(8, ahead("downloading", 0.9)),
        describeInertFader(8, ahead("separating", 0.5)),
        describeInertFader(8, ahead("ready")),
      ];
      expect(new Set(said.map(content => `${content.label} ${String(content.percent)}`)).size).toBe(said.length);
    });
  });
});
