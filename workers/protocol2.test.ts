import { describe, expect, it } from "vitest";
import {
  type TrackPipelineOutboundMessage,
  isAcquireFailedMessage,
  isAcquireTrackCommand,
  isRelayedThroughBackground,
  isTrackPipelineOutboundMessage,
} from "./protocol2";

const SAMPLES: Record<TrackPipelineOutboundMessage["type"], TrackPipelineOutboundMessage> = {
  "blk-acquire-failed": { type: "blk-acquire-failed", videoId: "DJCB1ZlseJ8", reason: "the url expired" },
  "blk-cache-hit": { type: "blk-cache-hit", videoId: "DJCB1ZlseJ8" },
  "blk-cache-miss": { type: "blk-cache-miss", videoId: "DJCB1ZlseJ8" },
  "blk-track-stage": { type: "blk-track-stage", videoId: "DJCB1ZlseJ8", stage: "separating" },
  "blk-track-progress": { type: "blk-track-progress", videoId: "DJCB1ZlseJ8", processed: 2, total: 9 },
  "blk-stem-chunk": {
    type: "blk-stem-chunk",
    videoId: "DJCB1ZlseJ8",
    stem: "vocals",
    index: 0,
    total: 1,
    data: "AAAA",
  },
  "blk-track-done": { type: "blk-track-done", videoId: "DJCB1ZlseJ8" },
  "blk-track-error": { type: "blk-track-error", videoId: "DJCB1ZlseJ8", code: "unknown", message: "boom" },
};

describe("isTrackPipelineOutboundMessage", () => {
  for (const [type, sample] of Object.entries(SAMPLES)) {
    it(`relays ${type}`, () => {
      expect(isTrackPipelineOutboundMessage(sample)).toBe(true);
    });
  }

  describe("regressions", () => {
    it("regression: relays blk-cache-miss", () => {
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-miss", videoId: "DJCB1ZlseJ8" })).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("refuses messages the relay does not own", () => {
      expect(isTrackPipelineOutboundMessage({ type: "blk-probe-cache", videoId: "DJCB1ZlseJ8" })).toBe(false);
      expect(isTrackPipelineOutboundMessage({ type: "blk-capture-chunk", videoId: "DJCB1ZlseJ8" })).toBe(false);
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-status" })).toBe(false);
    });

    it("refuses a message of the right type carrying no videoId to route by", () => {
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-miss" })).toBe(false);
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-hit", videoId: 42 })).toBe(false);
    });

    it("refuses anything that is not a message", () => {
      expect(isTrackPipelineOutboundMessage(null)).toBe(false);
      expect(isTrackPipelineOutboundMessage(undefined)).toBe(false);
      expect(isTrackPipelineOutboundMessage("blk-cache-miss")).toBe(false);
      expect(isTrackPipelineOutboundMessage({})).toBe(false);
    });
  });
});

describe("isAcquireTrackCommand", () => {
  const command = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: "blk-acquire-track",
    videoId: "9E3jQcUkXdQ",
    url: "https://rr3.googlevideo.com/videoplayback?itag=251&clen=1",
    ...overrides,
  });

  it("accepts a command naming a track and a url", () => {
    expect(isAcquireTrackCommand(command())).toBe(true);
  });

  describe("edge cases", () => {
    it("refuses a command missing any field it promises", () => {
      for (const missing of ["type", "videoId", "url"]) {
        const partial = command();
        delete partial[missing];
        expect(isAcquireTrackCommand(partial)).toBe(false);
      }
    });

    it("refuses an empty url, which would send the pipeline off to pull nothing", () => {
      expect(isAcquireTrackCommand(command({ url: "" }))).toBe(false);
    });

    it("refuses nonsense rather than throwing", () => {
      for (const nonsense of [null, undefined, 7, "text", []]) {
        expect(isAcquireTrackCommand(nonsense)).toBe(false);
      }
    });
  });
});

describe("isAcquireFailedMessage", () => {
  it("accepts a source reporting that it could not pull the track", () => {
    expect(isAcquireFailedMessage({ type: "blk-acquire-failed", videoId: "9E3jQcUkXdQ", reason: "403" })).toBe(true);
  });

  describe("edge cases", () => {
    it("refuses a report naming no track or no reason", () => {
      expect(isAcquireFailedMessage({ type: "blk-acquire-failed", reason: "403" })).toBe(false);
      expect(isAcquireFailedMessage({ type: "blk-acquire-failed", videoId: "9E3jQcUkXdQ" })).toBe(false);
    });

    it("refuses nonsense rather than throwing", () => {
      for (const nonsense of [null, undefined, 7, "text", []]) {
        expect(isAcquireFailedMessage(nonsense)).toBe(false);
      }
    });
  });
});

describe("isRelayedThroughBackground", () => {
  const probe = { type: "blk-probe-cache", videoId: "abc" };
  const forget = { type: "blk-forget-track", videoId: "abc" };
  const acquire = { type: "blk-acquire-track", videoId: "abc", url: "https://example.test/x" };
  const chunk = { type: "blk-capture-chunk", videoId: "abc", mimeType: "audio/webm", index: 0, total: 1, data: "AA" };
  const cancel = { type: "blk-cancel-separation" };

  it("names every command the background relays", () => {
    for (const message of [probe, forget, acquire, chunk]) {
      expect(isRelayedThroughBackground(message)).toBe(true);
    }
  });

  it("leaves the one command nothing relays to reach the offscreen straight from the tab", () => {
    expect(isRelayedThroughBackground(cancel)).toBe(false);
  });

  describe("edge cases", () => {
    it("treats anything unreadable as not relayed", () => {
      for (const message of [null, undefined, {}, 7, "blk-probe-cache", { type: "blk-probe-cache" }]) {
        expect(isRelayedThroughBackground(message)).toBe(false);
      }
    });
  });

  describe("regressions", () => {
    it("regression: a capture chunk taken from both senders was fed to the pipeline twice", () => {
      expect(isRelayedThroughBackground(chunk)).toBe(true);
    });

    it("regression: an acquire taken from both senders pulled every track over the network twice", () => {
      expect(isRelayedThroughBackground(acquire)).toBe(true);
    });
  });
});
