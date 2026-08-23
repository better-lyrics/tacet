import { describe, expect, it } from "vitest";
import { climbStep, fetchingSource, startClimb } from "@/acquisition/climb";
import { SOURCE_IDS } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState, KaraokeStatus } from "@/orchestrator/karaoke-state";
import { separationActivity } from "@/orchestrator/separation-activity";
import type { SeparationActivity } from "@/orchestrator/separation-activity";
import { separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationMode } from "@/settings/separation-mode";

const VIDEO_ID = "DJCB1ZlseJ8";

const MODES: SeparationMode[] = ["off", "on-demand", "every-track"];

const STATUSES: KaraokeStatus[] = ["waiting-for-capture", "ready-to-engage", "processing", "engaged", "failed"];

const KINDS: SeparationActivity["kind"][] = [
  "off",
  "asking",
  "waiting",
  "downloading",
  "working",
  "ready-to-engage",
  "engaged",
  "failed",
];

function state(patch: Partial<KaraokeState>): KaraokeState {
  return { ...initialKaraokeState(VIDEO_ID), ...patch };
}

const UNTOUCHED = state({ status: "waiting-for-capture" });

const STATES: (KaraokeState | null)[] = [
  null,
  UNTOUCHED,
  state({ status: "waiting-for-capture", downloadSource: "shadow-url", downloadFraction: 0.25 }),
  state({ status: "waiting-for-capture", downloadSource: "hidden-player", downloadFraction: 0.5 }),
  state({ status: "waiting-for-capture", downloadSource: "player-capture", downloadFraction: Number.NaN }),
  state({ status: "ready-to-engage" }),
  state({ status: "processing", stage: null }),
  state({ status: "processing", stage: "separating", processed: 3, total: 12 }),
  state({ status: "engaged" }),
  state({ status: "failed", reason: "no backend" }),
];

describe("separationActivity", () => {
  describe("happy path", () => {
    it("asks the listener to tap while nothing has asked for this track", () => {
      expect(separationActivity({ mode: "on-demand", armed: false, state: UNTOUCHED })).toEqual({ kind: "asking" });
    });

    it("reports the pipeline the moment the listener taps", () => {
      expect(separationActivity({ mode: "on-demand", armed: true, state: UNTOUCHED })).toEqual({ kind: "waiting" });
    });

    it("reports the pipeline throughout a mode that separates every track", () => {
      expect(separationActivity({ mode: "every-track", armed: false, state: UNTOUCHED })).toEqual({ kind: "waiting" });
      expect(separationActivity({ mode: "every-track", armed: true, state: state({ status: "engaged" }) })).toEqual({
        kind: "engaged",
      });
    });

    it("stays off while separation is off", () => {
      expect(separationActivity({ mode: "off", armed: false, state: UNTOUCHED })).toEqual({ kind: "off" });
    });

    it("carries the source and the fraction of a download", () => {
      const downloading = state({
        status: "waiting-for-capture",
        downloadSource: "hidden-player",
        downloadFraction: 0.5,
      });
      expect(separationActivity({ mode: "every-track", armed: false, state: downloading })).toEqual({
        kind: "downloading",
        source: "hidden-player",
        fraction: 0.5,
      });
    });

    it("carries the stage and the chunk count of a separation", () => {
      const working = state({ status: "processing", stage: "separating", processed: 3, total: 12 });
      expect(separationActivity({ mode: "every-track", armed: false, state: working })).toEqual({
        kind: "working",
        stage: "separating",
        processed: 3,
        total: 12,
      });
    });

    it("carries the reason a separation failed", () => {
      const failed = state({ status: "failed", reason: "no backend" });
      expect(separationActivity({ mode: "every-track", armed: false, state: failed })).toEqual({
        kind: "failed",
        reason: "no backend",
      });
    });

    it("reports a captured track waiting to be engaged", () => {
      expect(
        separationActivity({ mode: "every-track", armed: false, state: state({ status: "ready-to-engage" }) })
      ).toEqual({ kind: "ready-to-engage" });
    });
  });

  describe("edge cases", () => {
    it("keeps the off answer even when the fader is somehow still pulled down", () => {
      expect(separationActivity({ mode: "off", armed: true, state: state({ status: "engaged" }) })).toEqual({
        kind: "off",
      });
    });

    it("asks when there is no pipeline to report a state at all", () => {
      expect(separationActivity({ mode: "on-demand", armed: false, state: null })).toEqual({ kind: "asking" });
    });

    it("waits when a mode that separates every track has no pipeline yet", () => {
      expect(separationActivity({ mode: "every-track", armed: false, state: null })).toEqual({ kind: "waiting" });
    });

    it("keeps reporting a failure rather than asking over the top of it", () => {
      const failed = state({ status: "failed", reason: "no backend" });
      expect(separationActivity({ mode: "on-demand", armed: false, state: failed })).toEqual({
        kind: "failed",
        reason: "no backend",
      });
    });

    it("waits rather than downloading while no source has been named", () => {
      expect(separationActivity({ mode: "every-track", armed: false, state: UNTOUCHED })).toEqual({ kind: "waiting" });
    });

    it("passes a download fraction that is not yet a number straight through", () => {
      const downloading = state({
        status: "waiting-for-capture",
        downloadSource: "shadow-url",
        downloadFraction: Number.NaN,
      });
      const activity = separationActivity({ mode: "every-track", armed: false, state: downloading });
      expect(activity.kind).toBe("downloading");
      expect(activity.kind === "downloading" && Number.isNaN(activity.fraction)).toBe(true);
    });

    it("reports a failure with no reason as a failure without one", () => {
      const failed = state({ status: "failed", reason: null });
      expect(separationActivity({ mode: "every-track", armed: false, state: failed })).toEqual({
        kind: "failed",
        reason: null,
      });
    });
  });

  describe("invariants", () => {
    it("asks only when the veto says nothing asked for this track", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const current of STATES) {
            const veto = separationVeto({ mode, faderArmed: armed, role: "current" });
            if (separationActivity({ mode, armed, state: current }).kind === "asking") {
              expect(veto).toBe("nothing-asked-for-it");
            }
          }
        }
      }
    });

    it("goes off exactly when the veto blames the setting rather than the fader", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const current of STATES) {
            const veto = separationVeto({ mode, faderArmed: armed, role: "current" });
            expect(separationActivity({ mode, armed, state: current }).kind === "off").toBe(veto === "sing-along-off");
          }
        }
      }
    });

    it("reports the pipeline whenever the track may be separated", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const current of STATES) {
            if (separationVeto({ mode, faderArmed: armed, role: "current" }) !== null) continue;
            const kind = separationActivity({ mode, armed, state: current }).kind;
            expect(kind).not.toBe("off");
            expect(kind).not.toBe("asking");
          }
        }
      }
    });

    it("answers with one of the eight kinds for every combination", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const current of STATES) {
            expect(KINDS).toContain(separationActivity({ mode, armed, state: current }).kind);
          }
        }
      }
    });

    it("describes every status the state machine can hold", () => {
      for (const status of STATUSES) {
        const activity = separationActivity({ mode: "every-track", armed: false, state: state({ status }) });
        expect(activity.kind).not.toBe("off");
        expect(activity.kind).not.toBe("asking");
      }
    });

    it("reports the two separating modes identically once the listener has armed the fader", () => {
      for (const current of STATES) {
        expect(separationActivity({ mode: "on-demand", armed: true, state: current })).toEqual(
          separationActivity({ mode: "every-track", armed: true, state: current })
        );
      }
    });

    it("reports the two separating modes identically once the track is past waiting for capture", () => {
      const moved = STATES.filter(
        (current): current is KaraokeState => current !== null && current.status !== "waiting-for-capture"
      );
      expect(moved.length).toBeGreaterThan(0);
      for (const current of moved) {
        expect(separationActivity({ mode: "on-demand", armed: false, state: current })).toEqual(
          separationActivity({ mode: "every-track", armed: false, state: current })
        );
      }
    });

    it("never reports a download the state did not name a source for", () => {
      for (const mode of MODES) {
        for (const armed of [true, false]) {
          for (const current of STATES) {
            const activity = separationActivity({ mode, armed, state: current });
            if (activity.kind !== "downloading") continue;
            expect(current?.downloadSource).toBe(activity.source);
          }
        }
      }
    });
  });

  describe("regressions", () => {
    it("regression: the button does not report work that is not happening", () => {
      expect(separationActivity({ mode: "on-demand", armed: false, state: UNTOUCHED })).toEqual({ kind: "asking" });
    });

    it("regression: sing-along being off still wins over asking", () => {
      expect(separationActivity({ mode: "off", armed: false, state: UNTOUCHED })).toEqual({ kind: "off" });
    });

    it("regression: a track already separated is not offered for separation again", () => {
      const past: [KaraokeState, SeparationActivity["kind"]][] = [
        [state({ status: "ready-to-engage" }), "ready-to-engage"],
        [state({ status: "processing", stage: "decoding" }), "working"],
        [state({ status: "engaged" }), "engaged"],
      ];
      for (const [current, kind] of past) {
        expect(separationActivity({ mode: "on-demand", armed: false, state: current }).kind).toBe(kind);
      }
    });

    it("regression: the popup does not claim a download while nothing has asked for the track", () => {
      const downloading = state({
        status: "waiting-for-capture",
        downloadSource: "hidden-player",
        downloadFraction: 0.5,
      });
      expect(separationActivity({ mode: "on-demand", armed: false, state: downloading })).toEqual({ kind: "asking" });
    });

    it("regression: a shadow pull is not reported as the listener's own buffering", () => {
      const sources: SourceId[] = ["shadow-url", "hidden-player", "player-capture"];
      for (const source of sources) {
        const downloading = state({ status: "waiting-for-capture", downloadSource: source, downloadFraction: 0.4 });
        expect(separationActivity({ mode: "every-track", armed: false, state: downloading })).toEqual({
          kind: "downloading",
          source,
          fraction: 0.4,
        });
      }
    });
  });
});

// Every module below is individually correct and the listener still went quiet
// for a whole re-capture, because nothing dispatched the rung between two of
// them. The chain is therefore driven end to end rather than unit by unit.
describe("the chain from the source ladder to what the listener is told", () => {
  function climbAndTell(order: readonly SourceId[], events: number): SeparationActivity {
    const climb = startClimb(VIDEO_ID);
    let state = initialKaraokeState(VIDEO_ID);
    for (let taken = 0; taken < events; taken += 1) {
      const step = climbStep({ climb, order, playingTrack: true });
      if (step.kind === "waiting") break;
      climb.tried = step.tried;
      if (step.kind === "spent") climb.exhausted = true;
      else climb.inFlight = true;
      state = reduceKaraokeState(state, { type: "fetching", videoId: VIDEO_ID, source: fetchingSource(climb) });
      climb.inFlight = false;
    }
    return separationActivity({ mode: "on-demand", armed: true, state });
  }

  it("names the first rung as soon as the ladder starts it", () => {
    expect(climbAndTell(SOURCE_IDS, 1)).toEqual({ kind: "downloading", source: "shadow-url", fraction: Number.NaN });
  });

  it("names each rung in turn as the ladder climbs", () => {
    expect(climbAndTell(SOURCE_IDS, 2)).toEqual({ kind: "downloading", source: "hidden-player", fraction: Number.NaN });
  });

  it("falls back to the rung that keeps running once every source has been tried", () => {
    expect(climbAndTell(SOURCE_IDS, 3)).toEqual({
      kind: "downloading",
      source: "player-capture",
      fraction: Number.NaN,
    });
  });

  it("regression: a rung that is running is never reported as waiting for audio", () => {
    for (let events = 1; events <= SOURCE_IDS.length; events += 1) {
      expect(climbAndTell(SOURCE_IDS, events).kind).not.toBe("waiting");
    }
  });

  it("regression: the page world's fraction lands on the rung the ladder is on", () => {
    const climb = startClimb(VIDEO_ID);
    const step = climbStep({ climb, order: SOURCE_IDS, playingTrack: true });
    if (step.kind !== "start") throw new Error("the ladder should have started a rung");
    climb.tried = step.tried;
    climb.inFlight = true;

    let state = initialKaraokeState(VIDEO_ID);
    state = reduceKaraokeState(state, { type: "fetching", videoId: VIDEO_ID, source: fetchingSource(climb) });
    state = reduceKaraokeState(state, {
      type: "download-progress",
      videoId: VIDEO_ID,
      fraction: 0.42,
      source: "shadow-url",
    });

    expect(separationActivity({ mode: "on-demand", armed: true, state })).toEqual({
      kind: "downloading",
      source: "shadow-url",
      fraction: 0.42,
    });
  });

  it("regression: a fraction from the listener's own player is ignored while a rung is pulling", () => {
    const climb = startClimb(VIDEO_ID);
    const step = climbStep({ climb, order: SOURCE_IDS, playingTrack: true });
    if (step.kind !== "start") throw new Error("the ladder should have started a rung");
    climb.tried = step.tried;
    climb.inFlight = true;

    let state = initialKaraokeState(VIDEO_ID);
    state = reduceKaraokeState(state, { type: "fetching", videoId: VIDEO_ID, source: fetchingSource(climb) });
    state = reduceKaraokeState(state, {
      type: "download-progress",
      videoId: VIDEO_ID,
      fraction: 0.9,
      source: "player-capture",
    });

    expect(state.downloadFraction).toBeNaN();
  });
});
