import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/acquisition/sources";
import { BUFFERED_LABEL, FETCHED_LABEL, describeDownload } from "@/orchestrator/download-tooltip";

describe("describeDownload", () => {
  it("carries the fraction through as a percentage the card can render", () => {
    expect(describeDownload(0.4699, "player-capture")).toEqual({
      label: BUFFERED_LABEL,
      percent: 0.4699,
    });
  });

  it("names a rung that has to be started as a download", () => {
    expect(describeDownload(0.5, "shadow-url").label).toBe(FETCHED_LABEL);
    expect(describeDownload(0.5, "hidden-player").label).toBe(FETCHED_LABEL);
  });

  it("names the listener's own player as buffering", () => {
    expect(describeDownload(0.5, "player-capture").label).toBe(BUFFERED_LABEL);
  });

  describe("edge cases", () => {
    it("keeps the exact bounds", () => {
      expect(describeDownload(0, "player-capture").percent).toBe(0);
      expect(describeDownload(1, "player-capture").percent).toBe(1);
    });

    it("clamps a fraction outside the unit interval", () => {
      expect(describeDownload(-0.2, "player-capture").percent).toBe(0);
      expect(describeDownload(1.4, "player-capture").percent).toBe(1);
    });

    it("reports no percentage when the duration is unknown", () => {
      expect(describeDownload(Number.NaN, "player-capture").percent).toBeNull();
      expect(describeDownload(Number.POSITIVE_INFINITY, "player-capture").percent).toBeNull();
    });
  });

  describe("invariants", () => {
    it("gives every registered source a label of its own", () => {
      for (const source of SOURCE_IDS) {
        expect(describeDownload(0.5, source).label).not.toBe("");
      }
    });

    it("answers with one of the two labels, whichever source asked", () => {
      for (const source of SOURCE_IDS) {
        expect([FETCHED_LABEL, BUFFERED_LABEL]).toContain(describeDownload(0.5, source).label);
      }
    });

    it("marks both as still running with a trailing ellipsis, since the card adds none", () => {
      for (const label of [FETCHED_LABEL, BUFFERED_LABEL]) {
        expect(label).toMatch(/…$/);
      }
    });

    it("never ends a label with a full stop, which the rolling line would strand", () => {
      for (const label of [FETCHED_LABEL, BUFFERED_LABEL]) {
        expect(label).not.toMatch(/\.$/);
      }
    });

    it("keeps the two labels distinct, so the listener can tell the paths apart", () => {
      expect(FETCHED_LABEL).not.toBe(BUFFERED_LABEL);
    });
  });

  describe("regressions", () => {
    it("regression: a shadow pull does not read as the listener's own buffer", () => {
      expect(describeDownload(0.4, "shadow-url").label).not.toBe(BUFFERED_LABEL);
    });

    it("regression: the hidden player is still told apart from the listener's own playback", () => {
      expect(describeDownload(0.5, "hidden-player").label).not.toBe(describeDownload(0.5, "player-capture").label);
    });
  });
});
