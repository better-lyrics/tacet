import { describe, expect, it } from "vitest";
import {
  ASKING_LABEL,
  ENGAGE_LABEL,
  WAITING_LABEL,
  activityIsBusy,
  describeActivity,
  describeStage,
} from "@/orchestrator/busy-tooltip";
import { BUFFERED_LABEL, FETCHED_LABEL } from "@/orchestrator/download-tooltip";
import type { SeparationActivity, SeparationWork } from "@/orchestrator/separation-activity";
import { ARMED_LABEL } from "@/ui/armed-affordance";

const DOWNLOAD_LABELS = [BUFFERED_LABEL, FETCHED_LABEL];

const ACTIVITIES: SeparationActivity[] = [
  { kind: "off" },
  { kind: "asking" },
  { kind: "waiting" },
  { kind: "downloading", source: "shadow-url", fraction: 0.25 },
  { kind: "downloading", source: "hidden-player", fraction: 0.5 },
  { kind: "downloading", source: "player-capture", fraction: 0.75 },
  { kind: "working", stage: "separating", processed: 1, total: 4 },
  { kind: "working", stage: null, processed: 0, total: 0 },
  { kind: "ready-to-engage" },
  { kind: "engaged" },
  { kind: "failed", reason: "no backend" },
];

function work(patch: Partial<SeparationWork>): SeparationWork {
  return { stage: null, processed: 0, total: 0, ...patch };
}

describe("describeStage", () => {
  it("names each stage of the run", () => {
    const labels = (["checking-cache", "decoding", "downloading-model", "loading-model", "encoding"] as const).map(
      stage => describeStage(work({ stage })).label
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("reports separation as a fraction of the chunks done", () => {
    expect(describeStage(work({ stage: "separating", processed: 3, total: 12 }))).toEqual({
      label: "Separating vocals…",
      percent: 0.25,
    });
  });

  describe("edge cases", () => {
    it("withholds the percentage before the chunk count is known", () => {
      expect(describeStage(work({ stage: "separating", processed: 0, total: 0 })).percent).toBeNull();
    });

    it("falls back to a generic label for a stage it does not know", () => {
      expect(describeStage(work({ stage: null })).label).toBe("Preparing sing-along…");
      expect(describeStage(work({ stage: "teleporting" })).label).toBe("Preparing sing-along…");
    });
  });
});

describe("activityIsBusy", () => {
  it("counts the three kinds that have work in flight", () => {
    expect(activityIsBusy({ kind: "waiting" })).toBe(true);
    expect(activityIsBusy({ kind: "downloading", source: "hidden-player", fraction: 0.5 })).toBe(true);
    expect(activityIsBusy({ kind: "working", stage: "separating", processed: 1, total: 4 })).toBe(true);
  });

  it("counts nothing else", () => {
    for (const activity of ACTIVITIES) {
      const busy = ["waiting", "downloading", "working"].includes(activity.kind);
      expect(activityIsBusy(activity)).toBe(busy);
    }
  });
});

describe("describeActivity", () => {
  describe("happy path", () => {
    it("tells the listener what tapping the button does", () => {
      expect(describeActivity({ kind: "asking" }, false)).toEqual({ label: ASKING_LABEL, percent: null });
    });

    it("carries no progress while asking, because nothing is being measured", () => {
      expect(describeActivity({ kind: "asking" }, false)?.percent).toBeNull();
    });

    it("says it is waiting before any audio has arrived", () => {
      expect(describeActivity({ kind: "waiting" }, false)).toEqual({
        label: WAITING_LABEL,
        percent: null,
        note: null,
      });
    });

    it("reports the download while the capture is still coming in", () => {
      expect(describeActivity({ kind: "downloading", source: "hidden-player", fraction: 0.5 }, false)).toEqual({
        label: FETCHED_LABEL,
        percent: 0.5,
        note: null,
      });
    });

    it("reports the stage once the capture is being separated", () => {
      const activity: SeparationActivity = { kind: "working", stage: "separating", processed: 1, total: 4 };
      expect(describeActivity(activity, false)).toEqual({ label: "Separating vocals…", percent: 0.25, note: null });
    });

    it("adds the armed note without displacing the stage", () => {
      const activity: SeparationActivity = { kind: "working", stage: "separating", processed: 1, total: 4 };
      expect(describeActivity(activity, true)).toEqual({
        label: "Separating vocals…",
        percent: 0.25,
        note: ARMED_LABEL,
      });
    });

    it("offers the fader once a track is ready or already playing separated", () => {
      expect(describeActivity({ kind: "ready-to-engage" }, false)).toEqual({ label: ENGAGE_LABEL, percent: null });
      expect(describeActivity({ kind: "engaged" }, false)).toEqual({ label: ENGAGE_LABEL, percent: null });
    });

    it("names the reason a separation failed", () => {
      expect(describeActivity({ kind: "failed", reason: "no backend" }, false)).toEqual({
        label: "Sing-along unavailable: no backend",
        percent: null,
      });
    });
  });

  describe("edge cases", () => {
    it("says nothing at all while separation is off, because the inert tooltip has its own owner", () => {
      expect(describeActivity({ kind: "off" }, false)).toBeNull();
      expect(describeActivity({ kind: "off" }, true)).toBeNull();
    });

    it("falls back to an unnamed error when a failure carries no reason", () => {
      expect(describeActivity({ kind: "failed", reason: null }, false)).toEqual({
        label: "Sing-along unavailable: unknown error",
        percent: null,
      });
    });

    it("withholds the download percentage while the fraction is not yet a number", () => {
      const activity: SeparationActivity = { kind: "downloading", source: "shadow-url", fraction: Number.NaN };
      expect(describeActivity(activity, false)?.percent).toBeNull();
    });

    it("tells a pull the listener did not start apart from their own buffering", () => {
      const pulled: SeparationActivity = { kind: "downloading", source: "shadow-url", fraction: 0.4 };
      const buffered: SeparationActivity = { kind: "downloading", source: "player-capture", fraction: 0.4 };
      expect(describeActivity(pulled, false)?.label).toBe(FETCHED_LABEL);
      expect(describeActivity(buffered, false)?.label).toBe(BUFFERED_LABEL);
    });
  });

  describe("invariants", () => {
    it("answers for every kind except off", () => {
      for (const activity of ACTIVITIES) {
        const content = describeActivity(activity, false);
        if (activity.kind === "off") expect(content).toBeNull();
        else expect(content?.label.length).toBeGreaterThan(0);
      }
    });

    it("keeps the label identical whether or not the control is armed", () => {
      for (const activity of ACTIVITIES) {
        expect(describeActivity(activity, true)?.label).toBe(describeActivity(activity, false)?.label);
        expect(describeActivity(activity, true)?.percent).toEqual(describeActivity(activity, false)?.percent);
      }
    });

    it("carries a note only on the kinds that have work in flight, and only when armed", () => {
      for (const activity of ACTIVITIES) {
        const armed = describeActivity(activity, true);
        const idle = describeActivity(activity, false);
        expect(armed?.note ?? null).toBe(activityIsBusy(activity) ? ARMED_LABEL : null);
        expect(idle?.note ?? null).toBeNull();
      }
    });
  });

  describe("regressions", () => {
    it("regression: a separation stage is never described as a download", () => {
      const activity: SeparationActivity = { kind: "working", stage: "downloading-model", processed: 0, total: 0 };
      expect(describeActivity(activity, false)?.label).toBe("Downloading the separation model…");
      expect(DOWNLOAD_LABELS).not.toContain(describeActivity(activity, false)?.label);
    });

    it("regression: the download wording never reaches a kind that is not downloading", () => {
      for (const activity of ACTIVITIES) {
        if (activity.kind === "downloading") continue;
        expect(DOWNLOAD_LABELS).not.toContain(describeActivity(activity, false)?.label ?? "");
      }
    });

    it("regression: the ask and the engage offer are not the same sentence", () => {
      expect(ASKING_LABEL).not.toBe(ENGAGE_LABEL);
    });
  });
});
