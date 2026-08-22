import { describe, expect, it } from "vitest";
import { climbStep, startClimb } from "@/acquisition/climb";
import type { Climb } from "@/acquisition/climb";
import { SOURCE_IDS } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";

const DEFAULT_ORDER = SOURCE_IDS;

function walk(climb: Climb, order: readonly SourceId[], playingTrack: boolean): SourceId[] {
  const started: SourceId[] = [];
  for (;;) {
    const step = climbStep({ climb, order, playingTrack });
    if (step.kind === "waiting") return started;
    climb.tried = step.tried;
    if (step.kind === "spent") {
      climb.exhausted = true;
      return started;
    }
    started.push(step.source);
  }
}

describe("startClimb", () => {
  it("begins with nothing tried and nothing in flight", () => {
    expect(startClimb("abc123")).toEqual({ videoId: "abc123", tried: [], inFlight: false, exhausted: false });
  });
});

describe("climbStep", () => {
  it("starts the first rung the listener put in front", () => {
    const step = climbStep({ climb: startClimb("abc123"), order: DEFAULT_ORDER, playingTrack: true });
    expect(step).toEqual({ kind: "start", source: "shadow-url", tried: ["shadow-url"], passedOver: [] });
  });

  it("moves to the next rung once the first is spent", () => {
    const climb: Climb = { videoId: "abc123", tried: ["shadow-url"], inFlight: false, exhausted: false };
    const step = climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true });
    expect(step).toEqual({
      kind: "start",
      source: "hidden-player",
      tried: ["shadow-url", "hidden-player"],
      passedOver: [],
    });
  });

  it("passes over a rung that is already running rather than starting it", () => {
    const climb: Climb = {
      videoId: "abc123",
      tried: ["shadow-url", "hidden-player"],
      inFlight: false,
      exhausted: false,
    };
    const step = climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true });
    expect(step).toEqual({
      kind: "spent",
      tried: ["shadow-url", "hidden-player", "player-capture"],
      passedOver: ["player-capture"],
    });
  });

  it("reports itself spent once the ladder runs out", () => {
    const climb: Climb = { videoId: "abc123", tried: [...DEFAULT_ORDER], inFlight: false, exhausted: false };
    expect(climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true })).toEqual({
      kind: "spent",
      tried: [...DEFAULT_ORDER],
      passedOver: [],
    });
  });

  describe("the ahead track", () => {
    it("never reaches player capture, which cannot fetch a track nobody is playing", () => {
      const started = walk(startClimb("abc123"), DEFAULT_ORDER, false);
      expect(started).toEqual(["shadow-url", "hidden-player"]);
    });

    it("follows the order the listener stated", () => {
      const order: SourceId[] = ["hidden-player", "shadow-url", "player-capture"];
      expect(walk(startClimb("abc123"), order, false)).toEqual(["hidden-player", "shadow-url"]);
    });

    it("passes over nothing, since the rung it would pass over cannot reach the track at all", () => {
      const step = climbStep({ climb: startClimb("abc123"), order: ["player-capture"], playingTrack: false });
      expect(step).toEqual({ kind: "spent", tried: [], passedOver: [] });
    });
  });

  describe("edge cases", () => {
    it("waits while a rung is in flight", () => {
      const climb: Climb = { videoId: "abc123", tried: ["shadow-url"], inFlight: true, exhausted: false };
      expect(climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true })).toEqual({ kind: "waiting" });
    });

    it("waits once the ladder has already been declared spent", () => {
      const climb: Climb = { videoId: "abc123", tried: [...DEFAULT_ORDER], inFlight: false, exhausted: true };
      expect(climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true })).toEqual({ kind: "waiting" });
    });

    it("is spent immediately when the listener disabled every source", () => {
      expect(climbStep({ climb: startClimb("abc123"), order: [], playingTrack: true })).toEqual({
        kind: "spent",
        tried: [],
        passedOver: [],
      });
    });

    it("never tries a source the listener disabled", () => {
      const started = walk(startClimb("abc123"), ["shadow-url", "player-capture"], true);
      expect(started).toEqual(["shadow-url"]);
      expect(started).not.toContain("hidden-player");
    });
  });

  describe("invariants", () => {
    it("leaves the climb it was given untouched, so a caller decides when to commit", () => {
      const climb = startClimb("abc123");
      climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true });
      expect(climb.tried).toEqual([]);
      expect(climb.inFlight).toBe(false);
      expect(climb.exhausted).toBe(false);
    });

    it("never starts a rung twice, however far the ladder is walked", () => {
      const started = walk(startClimb("abc123"), DEFAULT_ORDER, true);
      expect(new Set(started).size).toBe(started.length);
    });

    it("reports every rung it took in tried, whether it started it or passed it over", () => {
      const climb = startClimb("abc123");
      const step = climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true });
      if (step.kind === "waiting") throw new Error("a fresh climb should not be waiting");
      expect(step.tried).toEqual([...step.passedOver, ...(step.kind === "start" ? [step.source] : [])]);
    });

    it("walking the current track's ladder to the end reaches every source once", () => {
      const climb = startClimb("abc123");
      walk(climb, DEFAULT_ORDER, true);
      expect([...climb.tried].sort()).toEqual([...SOURCE_IDS].sort());
    });
  });

  describe("regressions", () => {
    it("regression: with the hidden player off, the ahead track still climbs to the shadow player", () => {
      const climb = startClimb("abc123");
      expect(walk(climb, ["shadow-url", "player-capture"], false)).toEqual(["shadow-url"]);
    });

    it("regression: two climbs over one order do not share state", () => {
      const current = startClimb("abc123");
      const ahead = startClimb("xyz789");
      walk(current, DEFAULT_ORDER, true);
      expect(ahead.tried).toEqual([]);
      expect(climbStep({ climb: ahead, order: DEFAULT_ORDER, playingTrack: false })).toEqual({
        kind: "start",
        source: "shadow-url",
        tried: ["shadow-url"],
        passedOver: [],
      });
    });

    it("regression: a spent ladder says so once, then waits rather than repeating itself", () => {
      const climb = startClimb("abc123");
      walk(climb, DEFAULT_ORDER, true);
      expect(climb.exhausted).toBe(true);
      expect(climbStep({ climb, order: DEFAULT_ORDER, playingTrack: true })).toEqual({ kind: "waiting" });
    });
  });
});
