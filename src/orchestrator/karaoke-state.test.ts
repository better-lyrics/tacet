import { describe, expect, it } from "vitest";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";

describe("initialKaraokeState", () => {
  it("starts waiting-for-capture for the given track, with no progress or reason", () => {
    expect(initialKaraokeState("video-1")).toEqual({
      status: "waiting-for-capture",
      videoId: "video-1",
      stage: null,
      processed: 0,
      total: 0,
      reason: null,
      downloadFraction: Number.NaN,
      downloadSource: null,
    });
  });

  it("regression: names no download source until one reports", () => {
    expect(initialKaraokeState("video-1").downloadSource).toBeNull();

    const reporting = reduceKaraokeState(initialKaraokeState("video-1"), {
      type: "download-progress",
      videoId: "video-1",
      fraction: 0.4,
      source: "hidden-player",
    });
    expect(reporting.downloadSource).toBe("hidden-player");
  });
});

describe("track-changed", () => {
  it("resets to waiting-for-capture for a new videoId from any status", () => {
    const engaged: KaraokeState = {
      status: "engaged",
      videoId: "video-1",
      stage: null,
      processed: 10,
      total: 10,
      reason: null,
      downloadFraction: 0,
      downloadSource: "listener-playback",
    };
    expect(reduceKaraokeState(engaged, { type: "track-changed", videoId: "video-2" })).toEqual(
      initialKaraokeState("video-2")
    );
  });

  it("resets from a failed state too", () => {
    const failed: KaraokeState = {
      status: "failed",
      videoId: "video-1",
      stage: null,
      processed: 0,
      total: 0,
      reason: "boom",
      downloadFraction: 0,
      downloadSource: "listener-playback",
    };
    expect(reduceKaraokeState(failed, { type: "track-changed", videoId: "video-2" })).toEqual(
      initialKaraokeState("video-2")
    );
  });

  it("is a no-op for the same videoId, returning the identical state", () => {
    const state = initialKaraokeState("video-1");
    expect(reduceKaraokeState(state, { type: "track-changed", videoId: "video-1" })).toBe(state);
  });
});

describe("reacquire", () => {
  it("returns the same track to waiting-for-capture, clearing the stage it stalled on", () => {
    const encoding: KaraokeState = {
      status: "processing",
      videoId: "video-1",
      stage: "encoding",
      processed: 9,
      total: 10,
      reason: null,
      downloadFraction: 1,
      downloadSource: "hidden-player",
    };
    expect(reduceKaraokeState(encoding, { type: "reacquire", videoId: "video-1" })).toEqual(
      initialKaraokeState("video-1")
    );
  });

  it("regression: leaves a stale stage nowhere for the card to read", () => {
    const encoding: KaraokeState = {
      status: "processing",
      videoId: "video-1",
      stage: "encoding",
      processed: 9,
      total: 10,
      reason: null,
      downloadFraction: 1,
      downloadSource: "hidden-player",
    };
    expect(reduceKaraokeState(encoding, { type: "reacquire", videoId: "video-1" }).stage).toBeNull();
  });

  it("ignores a reacquire aimed at a track that is no longer playing", () => {
    const state = initialKaraokeState("video-1");
    expect(reduceKaraokeState(state, { type: "reacquire", videoId: "video-2" })).toBe(state);
  });
});

describe("capture-ready", () => {
  it("moves waiting-for-capture to ready-to-engage", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    expect(next.status).toBe("ready-to-engage");
  });

  it("is ignored for a videoId that is not the current track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-2" });
    expect(next).toBe(state);
  });

  it("is ignored once already past waiting-for-capture", () => {
    const ready = reduceKaraokeState(initialKaraokeState("video-1"), {
      type: "capture-ready",
      videoId: "video-1",
    });
    const again = reduceKaraokeState(ready, { type: "capture-ready", videoId: "video-1" });
    expect(again).toBe(ready);
  });
});

describe("cache-hit", () => {
  it("moves waiting-for-capture straight to processing, skipping engagement", () => {
    const next = reduceKaraokeState(initialKaraokeState("video-1"), { type: "cache-hit", videoId: "video-1" });
    expect(next.status).toBe("processing");
    expect(next.stage).toBe("checking-cache");
  });

  it("is ignored for a videoId that is not the current track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "cache-hit", videoId: "video-2" });
    expect(next).toBe(state);
  });

  it("is ignored once the user has already engaged", () => {
    let state = reduceKaraokeState(initialKaraokeState("video-1"), { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    const again = reduceKaraokeState(state, { type: "cache-hit", videoId: "video-1" });
    expect(again).toBe(state);
  });

  it("is idempotent", () => {
    const hit = reduceKaraokeState(initialKaraokeState("video-1"), { type: "cache-hit", videoId: "video-1" });
    expect(reduceKaraokeState(hit, { type: "cache-hit", videoId: "video-1" })).toBe(hit);
  });

  it("reaches engaged once the cached stems load", () => {
    const hit = reduceKaraokeState(initialKaraokeState("video-1"), { type: "cache-hit", videoId: "video-1" });
    const loaded = reduceKaraokeState(hit, { type: "stems-loaded", videoId: "video-1" });
    expect(loaded.status).toBe("engaged");
  });
});

describe("acquiring", () => {
  it("moves waiting-for-capture to processing with no stage of its own", () => {
    const next = reduceKaraokeState(initialKaraokeState("video-1"), { type: "acquiring", videoId: "video-1" });
    expect(next.status).toBe("processing");
    expect(next.stage).toBeNull();
  });

  it("is ignored for a videoId that is not the current track", () => {
    const state = initialKaraokeState("video-1");
    expect(reduceKaraokeState(state, { type: "acquiring", videoId: "video-2" })).toBe(state);
  });

  it("is ignored once the track is engaged", () => {
    let state = reduceKaraokeState(initialKaraokeState("video-1"), { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "stems-loaded", videoId: "video-1" });
    expect(reduceKaraokeState(state, { type: "acquiring", videoId: "video-1" })).toBe(state);
  });

  it("does not undo a stage a running separation has already reported", () => {
    let state = reduceKaraokeState(initialKaraokeState("video-1"), { type: "acquiring", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "stage", videoId: "video-1", stage: "separating" });
    expect(reduceKaraokeState(state, { type: "acquiring", videoId: "video-1" }).stage).toBe("separating");
  });

  it("regression: a source that fails leaves the track ready for the next one to try", () => {
    const acquiring = reduceKaraokeState(initialKaraokeState("video-1"), { type: "acquiring", videoId: "video-1" });
    const spent = reduceKaraokeState(acquiring, { type: "reacquire", videoId: "video-1" });
    expect(spent.status).toBe("waiting-for-capture");
    expect(reduceKaraokeState(spent, { type: "acquiring", videoId: "video-1" }).status).toBe("processing");
  });
});

describe("engage", () => {
  function readyState(): KaraokeState {
    return reduceKaraokeState(initialKaraokeState("video-1"), { type: "capture-ready", videoId: "video-1" });
  }

  it("moves ready-to-engage to processing", () => {
    const next = reduceKaraokeState(readyState(), { type: "engage", videoId: "video-1" });
    expect(next.status).toBe("processing");
  });

  it("is ignored while still waiting-for-capture", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    expect(next).toBe(state);
  });

  it("is idempotent once already processing", () => {
    const processing = reduceKaraokeState(readyState(), { type: "engage", videoId: "video-1" });
    const again = reduceKaraokeState(processing, { type: "engage", videoId: "video-1" });
    expect(again).toBe(processing);
  });

  it("is idempotent once already engaged", () => {
    let state = readyState();
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "stems-loaded", videoId: "video-1" });
    const again = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    expect(again).toBe(state);
  });
});

describe("stage and progress", () => {
  function processingState(): KaraokeState {
    let state = initialKaraokeState("video-1");
    state = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    return state;
  }

  it("records the stage while processing", () => {
    const next = reduceKaraokeState(processingState(), { type: "stage", videoId: "video-1", stage: "decoding" });
    expect(next.stage).toBe("decoding");
    expect(next.status).toBe("processing");
  });

  it("records processed and total while processing", () => {
    const next = reduceKaraokeState(processingState(), {
      type: "progress",
      videoId: "video-1",
      processed: 3,
      total: 10,
    });
    expect(next.processed).toBe(3);
    expect(next.total).toBe(10);
  });

  it("is ignored outside of processing", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "progress", videoId: "video-1", processed: 3, total: 10 });
    expect(next).toBe(state);
  });
});

describe("download-progress", () => {
  it("records the buffered fraction while waiting for capture", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, {
      type: "download-progress",
      source: "listener-playback",
      videoId: "video-1",
      fraction: 0.42,
    });
    expect(next.downloadFraction).toBe(0.42);
    expect(next.status).toBe("waiting-for-capture");
  });

  it("is ignored once past waiting-for-capture", () => {
    const ready = reduceKaraokeState(initialKaraokeState("video-1"), {
      type: "capture-ready",
      videoId: "video-1",
    });
    const next = reduceKaraokeState(ready, {
      type: "download-progress",
      source: "listener-playback",
      videoId: "video-1",
      fraction: 0.9,
    });
    expect(next).toBe(ready);
  });

  it("is ignored for a stale videoId from a previous track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, {
      type: "download-progress",
      source: "listener-playback",
      videoId: "video-0",
      fraction: 0.5,
    });
    expect(next).toBe(state);
  });
});

describe("stems-loaded", () => {
  it("moves processing to engaged and clears any reason", () => {
    let state = initialKaraokeState("video-1");
    state = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    const next = reduceKaraokeState(state, { type: "stems-loaded", videoId: "video-1" });
    expect(next.status).toBe("engaged");
    expect(next.reason).toBeNull();
  });

  it("is ignored outside of processing", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "stems-loaded", videoId: "video-1" });
    expect(next).toBe(state);
  });
});

describe("failed", () => {
  it("moves any status to failed with the given reason, for the current track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "failed", videoId: "video-1", reason: "no captured audio" });
    expect(next.status).toBe("failed");
    expect(next.reason).toBe("no captured audio");
  });

  it("fails out of processing too", () => {
    let state = initialKaraokeState("video-1");
    state = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    const next = reduceKaraokeState(state, { type: "failed", videoId: "video-1", reason: "separation crashed" });
    expect(next.status).toBe("failed");
  });

  it("is ignored for a stale videoId from a previous track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "failed", videoId: "video-0", reason: "stale" });
    expect(next).toBe(state);
  });

  describe("regressions", () => {
    it("a failed state ignores engage, but a fresh acquisition clears it", () => {
      const failed = reduceKaraokeState(initialKaraokeState("video-1"), {
        type: "failed",
        videoId: "video-1",
        reason: "boom",
      });
      expect(reduceKaraokeState(failed, { type: "engage", videoId: "video-1" })).toBe(failed);

      const recovered = reduceKaraokeState(failed, { type: "capture-ready", videoId: "video-1" });
      expect(recovered.status).toBe("ready-to-engage");
      expect(recovered.reason).toBeNull();
    });
  });
});

describe("crossfaded", () => {
  const engaged: KaraokeState = {
    status: "engaged",
    videoId: "video-1",
    stage: null,
    processed: 7,
    total: 7,
    reason: null,
    downloadFraction: 0,
    downloadSource: "listener-playback",
  };

  it("lands on the new track already engaged, since its stems are in the deck", () => {
    const next = reduceKaraokeState(engaged, { type: "crossfaded", videoId: "video-2" });
    expect(next.status).toBe("engaged");
    expect(next.videoId).toBe("video-2");
  });

  it("clears the previous track's progress, stage and reason", () => {
    const failed: KaraokeState = { ...engaged, status: "failed", stage: "separating", reason: "boom" };
    const next = reduceKaraokeState(failed, { type: "crossfaded", videoId: "video-2" });
    expect(next).toEqual({ ...initialKaraokeState("video-2"), status: "engaged" });
  });

  describe("edge cases", () => {
    it("is accepted from any prior status, because the fade does not consult it", () => {
      for (const status of ["waiting-for-capture", "ready-to-engage", "processing", "engaged", "failed"] as const) {
        const next = reduceKaraokeState({ ...engaged, status }, { type: "crossfaded", videoId: "video-2" });
        expect(next.status).toBe("engaged");
      }
    });

    it("still engages when the videoId did not actually change", () => {
      const next = reduceKaraokeState({ ...engaged, status: "failed" }, { type: "crossfaded", videoId: "video-1" });
      expect(next.status).toBe("engaged");
      expect(next.videoId).toBe("video-1");
    });
  });

  describe("regressions", () => {
    it("regression: a crossfade never leaves the fader shimmering as if it were still working", () => {
      const processing: KaraokeState = { ...engaged, status: "processing", stage: "separating" };
      const next = reduceKaraokeState(processing, { type: "crossfaded", videoId: "video-2" });
      expect(next.status).toBe("engaged");
      expect(next.stage).toBeNull();
    });
  });
});

describe("invariants", () => {
  it("a crossfade and a plain track change agree on everything but status", () => {
    const engaged: KaraokeState = {
      status: "engaged",
      videoId: "video-1",
      stage: "separating",
      processed: 3,
      total: 9,
      reason: "old",
      downloadFraction: 0.5,
      downloadSource: "hidden-player",
    };
    const changed = reduceKaraokeState(engaged, { type: "track-changed", videoId: "video-2" });
    const crossfaded = reduceKaraokeState(engaged, { type: "crossfaded", videoId: "video-2" });
    expect({ ...crossfaded, status: changed.status }).toEqual(changed);
  });

  it("processed and total are always zero immediately after a track change", () => {
    const engaged: KaraokeState = {
      status: "engaged",
      videoId: "video-1",
      stage: null,
      processed: 7,
      total: 7,
      reason: null,
      downloadFraction: 0,
      downloadSource: "listener-playback",
    };
    const next = reduceKaraokeState(engaged, { type: "track-changed", videoId: "video-2" });
    expect(next.processed).toBe(0);
    expect(next.total).toBe(0);
  });

  it("an event for a videoId other than the current one never changes status", () => {
    const state = initialKaraokeState("video-1");
    for (const event of [
      { type: "capture-ready" as const, videoId: "other" },
      { type: "cache-hit" as const, videoId: "other" },
      { type: "acquiring" as const, videoId: "other" },
      { type: "engage" as const, videoId: "other" },
      { type: "stems-loaded" as const, videoId: "other" },
      { type: "failed" as const, videoId: "other", reason: "x" },
    ]) {
      expect(reduceKaraokeState(state, event).status).toBe(state.status);
    }
  });
});
