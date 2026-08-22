import { describe, expect, it } from "vitest";
import type { SeparationMode } from "@/settings/separation-mode";
import { hasSomethingToSettle } from "@/ui/fader-disabled-gate";
import { settlesForTrackChange } from "@/ui/fader-track-settle";

const MODES: SeparationMode[] = ["off", "on-demand", "every-track"];

function afterTrackChange(mode: SeparationMode, value: number): number {
  if (!settlesForTrackChange({ mode, previousVideoId: "aaaaaaaaaaa", videoId: "bbbbbbbbbbb" })) return value;
  return hasSomethingToSettle(value) ? 0 : value;
}

describe("settlesForTrackChange", () => {
  it("settles when the listener moves to another track and the button is an action", () => {
    expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: "aaa", videoId: "bbb" })).toBe(true);
  });

  it("leaves a mode that separates every track alone, where the button is a level", () => {
    expect(settlesForTrackChange({ mode: "every-track", previousVideoId: "aaa", videoId: "bbb" })).toBe(false);
  });

  it("leaves a mode that does nothing alone", () => {
    expect(settlesForTrackChange({ mode: "off", previousVideoId: "aaa", videoId: "bbb" })).toBe(false);
  });

  describe("edge cases", () => {
    it("says nothing to do while the same track plays on", () => {
      expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: "aaa", videoId: "aaa" })).toBe(false);
    });

    it("does not settle on the very first state, where there is no previous track", () => {
      expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: null, videoId: "aaa" })).toBe(false);
    });

    it("does not settle out of the empty track a fresh pipeline starts on", () => {
      expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: "", videoId: "aaa" })).toBe(false);
    });

    it("does not settle into an empty track", () => {
      expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: "aaa", videoId: "" })).toBe(false);
    });
  });

  describe("invariants", () => {
    it("never settles without a genuine change from one named track to another", () => {
      for (const mode of MODES) {
        expect(settlesForTrackChange({ mode, previousVideoId: null, videoId: "" })).toBe(false);
        expect(settlesForTrackChange({ mode, previousVideoId: "", videoId: "" })).toBe(false);
        expect(settlesForTrackChange({ mode, previousVideoId: "aaa", videoId: "aaa" })).toBe(false);
      }
    });

    it("is idempotent, since the second call sees the same track", () => {
      expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: "aaa", videoId: "bbb" })).toBe(true);
      expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: "bbb", videoId: "bbb" })).toBe(false);
    });

    it("on demand is the only mode that ever settles", () => {
      const settling = MODES.filter(mode => settlesForTrackChange({ mode, previousVideoId: "aaa", videoId: "bbb" }));
      expect(settling).toEqual(["on-demand"]);
    });
  });

  describe("regressions", () => {
    it("regression: one tap in on demand does not separate the tracks that follow", () => {
      expect(afterTrackChange("on-demand", -1)).toBe(0);
    });

    it("regression: a track change never moves a fader the listener set for every track", () => {
      expect(afterTrackChange("every-track", -1)).toBe(-1);
      expect(afterTrackChange("every-track", -0.4)).toBe(-0.4);
    });

    it("regression: a crossfade landing on another track settles as any other change does", () => {
      expect(settlesForTrackChange({ mode: "on-demand", previousVideoId: "aaa", videoId: "bbb" })).toBe(true);
    });

    it("regression: a neutral fader is left where it is rather than committed again", () => {
      expect(hasSomethingToSettle(0)).toBe(false);
      expect(afterTrackChange("on-demand", 0)).toBe(0);
    });
  });
});
