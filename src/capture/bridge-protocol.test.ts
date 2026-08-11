import { describe, expect, it } from "vitest";
import {
  isCaptureReadyMessage,
  isCaptureStandDownMessage,
  isPartialCaptureMessage,
  isPrefetchedAudioMessage,
  isRequestNextPrefetchMessage,
  isRequestPrefetchMessage,
  isRequestPrefetchedAudioMessage,
  isCapturedAudioMessage,
  isCapturedAudioUnavailableMessage,
  isRequestCapturedAudioMessage,
  isSliceCapturedMessage,
} from "@/capture/bridge-protocol";
import type {
  CaptureReadyMessage,
  CaptureStandDownMessage,
  PartialCaptureMessage,
  PrefetchedAudioMessage,
  RequestPrefetchMessage,
  RequestPrefetchedAudioMessage,
  CapturedAudioMessage,
  CapturedAudioUnavailableMessage,
  RequestCapturedAudioMessage,
  SliceCapturedMessage,
} from "@/capture/bridge-protocol";

function sliceCaptured(overrides: Partial<SliceCapturedMessage> = {}): Record<string, unknown> {
  return {
    type: "blk-slice-captured",
    videoId: "abc123",
    index: 0,
    startSeconds: 0,
    reachedSeconds: 215.1,
    trackDurationSeconds: 215.1,
    mimeType: "audio/webm",
    bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    ...overrides,
  };
}

describe("capture bridge protocol", () => {
  it("round-trips blk-request-captured-audio through structured clone", () => {
    const message: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId: "abc123" };
    expect(isRequestCapturedAudioMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-captured-audio with its buffer transferred, not copied", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const message: CapturedAudioMessage = {
      type: "blk-captured-audio",
      videoId: "abc123",
      mimeType: "audio/webm",
      bytes,
    };

    const cloned = structuredClone(message, { transfer: [bytes] });

    expect(isCapturedAudioMessage(cloned)).toBe(true);
    if (!isCapturedAudioMessage(cloned)) throw new Error("unreachable");
    expect(Array.from(new Uint8Array(cloned.bytes))).toEqual([1, 2, 3, 4]);
    expect(bytes.byteLength).toBe(0);
  });

  it("round-trips blk-captured-audio-unavailable", () => {
    const message: CapturedAudioUnavailableMessage = {
      type: "blk-captured-audio-unavailable",
      videoId: "abc123",
      reason: "no chunks captured for this track",
    };
    expect(isCapturedAudioUnavailableMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-capture-ready", () => {
    const message: CaptureReadyMessage = { type: "blk-capture-ready", videoId: "abc123" };
    expect(isCaptureReadyMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-request-prefetch", () => {
    const message: RequestPrefetchMessage = { type: "blk-request-prefetch", videoId: "abc123" };
    expect(isRequestPrefetchMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-capture-stand-down", () => {
    const message: CaptureStandDownMessage = { type: "blk-capture-stand-down", videoId: "abc123" };
    expect(isCaptureStandDownMessage(structuredClone(message))).toBe(true);
  });

  describe("edge cases", () => {
    it("rejects null, primitives, and unrelated objects", () => {
      expect(isRequestCapturedAudioMessage(null)).toBe(false);
      expect(isRequestCapturedAudioMessage(undefined)).toBe(false);
      expect(isRequestCapturedAudioMessage("blk-request-captured-audio")).toBe(false);
      expect(isRequestCapturedAudioMessage({ foo: "bar" })).toBe(false);
    });

    it("rejects a request message missing videoId", () => {
      expect(isRequestCapturedAudioMessage({ type: "blk-request-captured-audio" })).toBe(false);
    });

    it("does not confuse a prefetch request with a request for captured audio", () => {
      expect(isRequestPrefetchMessage({ type: "blk-request-prefetch" })).toBe(false);
      expect(isRequestPrefetchMessage({ type: "blk-request-captured-audio", videoId: "abc123" })).toBe(false);
      expect(isRequestCapturedAudioMessage({ type: "blk-request-prefetch", videoId: "abc123" })).toBe(false);
    });

    it("rejects a stand-down message missing videoId, and does not confuse it with capture-ready", () => {
      expect(isCaptureStandDownMessage({ type: "blk-capture-stand-down" })).toBe(false);
      expect(isCaptureStandDownMessage({ type: "blk-capture-ready", videoId: "abc123" })).toBe(false);
      expect(isCaptureReadyMessage({ type: "blk-capture-stand-down", videoId: "abc123" })).toBe(false);
    });

    it("rejects a captured-audio message whose bytes are not an ArrayBuffer", () => {
      const malformed = { type: "blk-captured-audio", videoId: "abc123", mimeType: "audio/webm", bytes: [1, 2, 3] };
      expect(isCapturedAudioMessage(malformed)).toBe(false);
    });

    it("rejects an unavailable message missing a reason", () => {
      expect(isCapturedAudioUnavailableMessage({ type: "blk-captured-audio-unavailable", videoId: "abc123" })).toBe(
        false
      );
    });

    it("does not cross-match another message's discriminant", () => {
      const readyMessage: CaptureReadyMessage = { type: "blk-capture-ready", videoId: "abc123" };
      expect(isRequestCapturedAudioMessage(readyMessage)).toBe(false);
      expect(isCapturedAudioMessage(readyMessage)).toBe(false);
      expect(isCapturedAudioUnavailableMessage(readyMessage)).toBe(false);
      expect(isSliceCapturedMessage(readyMessage)).toBe(false);
    });
  });

  describe("blk-slice-captured", () => {
    it("round-trips through structured clone", () => {
      expect(isSliceCapturedMessage(structuredClone(sliceCaptured()))).toBe(true);
    });

    it("accepts a slice that stopped short, since refusing it is the opener's job", () => {
      expect(isSliceCapturedMessage(sliceCaptured({ reachedSeconds: 55 }))).toBe(true);
    });

    it("rejects a slice that does not say how far it reached", () => {
      const { reachedSeconds: _reached, ...withoutReach } = sliceCaptured();
      expect(isSliceCapturedMessage(withoutReach)).toBe(false);

      const { trackDurationSeconds: _duration, ...withoutDuration } = sliceCaptured();
      expect(isSliceCapturedMessage(withoutDuration)).toBe(false);
    });

    it("rejects coverage numbers that are not numbers", () => {
      expect(isSliceCapturedMessage(sliceCaptured({ reachedSeconds: "215" as unknown as number }))).toBe(false);
      expect(isSliceCapturedMessage(sliceCaptured({ trackDurationSeconds: null as unknown as number }))).toBe(false);
    });
  });

  describe("blk-request-prefetched-audio and blk-prefetched-audio", () => {
    const request: RequestPrefetchedAudioMessage = { type: "blk-request-prefetched-audio", videoId: "abc123" };
    const reply = (overrides: Partial<PrefetchedAudioMessage> = {}): Record<string, unknown> => ({
      type: "blk-prefetched-audio",
      videoId: "abc123",
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
      ...overrides,
    });

    it("accepts the pair it was written for", () => {
      expect(isRequestPrefetchedAudioMessage(request)).toBe(true);
      expect(isPrefetchedAudioMessage(reply())).toBe(true);
    });

    it("round-trips the reply with its buffer transferred, not copied", () => {
      const bytes = new Uint8Array([9, 8, 7]).buffer;
      const message: PrefetchedAudioMessage = { type: "blk-prefetched-audio", videoId: "abc123", bytes };

      const cloned = structuredClone(message, { transfer: [bytes] });

      expect(isPrefetchedAudioMessage(cloned)).toBe(true);
      if (!isPrefetchedAudioMessage(cloned)) throw new Error("guard rejected its own message");
      expect(Array.from(new Uint8Array(cloned.bytes))).toEqual([9, 8, 7]);
      expect(bytes.byteLength).toBe(0);
    });

    describe("edge cases", () => {
      it("rejects null, undefined and primitives", () => {
        for (const guard of [isRequestPrefetchedAudioMessage, isPrefetchedAudioMessage]) {
          for (const value of [null, undefined, 0, "", [], true, { foo: "bar" }]) expect(guard(value)).toBe(false);
        }
      });

      it.each([
        ["a wrong type", { ...request, type: "blk-request-prefetched" }],
        ["a missing videoId", { type: "blk-request-prefetched-audio" }],
        ["a non-string videoId", { ...request, videoId: 7 }],
      ])("rejects a request with %s", (_case, malformed) => {
        expect(isRequestPrefetchedAudioMessage(malformed)).toBe(false);
      });

      it.each([
        ["a wrong type", reply({ type: "blk-prefetched" as PrefetchedAudioMessage["type"] })],
        ["a missing videoId", { type: "blk-prefetched-audio", bytes: new ArrayBuffer(4) }],
        ["a non-string videoId", reply({ videoId: 7 as unknown as string })],
        ["missing bytes", { type: "blk-prefetched-audio", videoId: "abc123" }],
        ["bytes that are a plain array", reply({ bytes: [1, 2, 3] as unknown as ArrayBuffer })],
        [
          "bytes that are a view rather than a buffer",
          reply({ bytes: new Uint8Array([1, 2]) as unknown as ArrayBuffer }),
        ],
      ])("rejects a reply with %s", (_case, malformed) => {
        expect(isPrefetchedAudioMessage(malformed)).toBe(false);
      });

      it("accepts an empty buffer, since judging the bytes is the decoder's job", () => {
        expect(isPrefetchedAudioMessage(reply({ bytes: new ArrayBuffer(0) }))).toBe(true);
      });
    });

    describe("invariants", () => {
      const others: { name: string; message: unknown }[] = [
        { name: "blk-request-captured-audio", message: { type: "blk-request-captured-audio", videoId: "abc123" } },
        {
          name: "blk-captured-audio",
          message: {
            type: "blk-captured-audio",
            videoId: "abc123",
            mimeType: "audio/webm",
            bytes: new ArrayBuffer(4),
          },
        },
        {
          name: "blk-captured-audio-unavailable",
          message: { type: "blk-captured-audio-unavailable", videoId: "abc123", reason: "nothing held" },
        },
        { name: "blk-capture-ready", message: { type: "blk-capture-ready", videoId: "abc123" } },
        { name: "blk-request-prefetch", message: { type: "blk-request-prefetch", videoId: "abc123" } },
        { name: "blk-request-next-prefetch", message: { type: "blk-request-next-prefetch", videoId: "abc123" } },
        { name: "blk-capture-stand-down", message: { type: "blk-capture-stand-down", videoId: "abc123" } },
        { name: "blk-slice-captured", message: sliceCaptured() },
      ];

      it.each(others)("neither new guard accepts $name", ({ message }) => {
        expect(isRequestPrefetchedAudioMessage(message)).toBe(false);
        expect(isPrefetchedAudioMessage(message)).toBe(false);
      });

      it("the new messages match no existing guard, so a relay can dispatch on the first hit", () => {
        const existing = [
          isRequestCapturedAudioMessage,
          isCapturedAudioMessage,
          isCapturedAudioUnavailableMessage,
          isCaptureReadyMessage,
          isRequestPrefetchMessage,
          isRequestNextPrefetchMessage,
          isCaptureStandDownMessage,
          isSliceCapturedMessage,
        ];
        for (const guard of existing) {
          expect(guard(request)).toBe(false);
          expect(guard(reply())).toBe(false);
        }
      });

      it("the request and the reply stay distinct despite sharing a videoId", () => {
        expect(isPrefetchedAudioMessage(request)).toBe(false);
        expect(isRequestPrefetchedAudioMessage(reply())).toBe(false);
      });
    });

    describe("regressions", () => {
      it("regression: the reply carries no mimeType, since decodeAudioData sniffs the container", () => {
        expect(isPrefetchedAudioMessage(reply())).toBe(true);
        expect("mimeType" in reply()).toBe(false);
      });

      it("regression: a reply without a videoId is rejected, so a caller never binds bytes to the wrong track", () => {
        expect(isPrefetchedAudioMessage({ type: "blk-prefetched-audio", bytes: new ArrayBuffer(4) })).toBe(false);
      });
    });
  });
});

describe("blk-partial-capture", () => {
  const partial: PartialCaptureMessage = {
    type: "blk-partial-capture",
    videoId: "AMCwYdTJ_PE",
    coveredSeconds: 56.6,
    trackSeconds: 237,
  };

  it("accepts a short capture announcement", () => {
    expect(isPartialCaptureMessage(partial)).toBe(true);
  });

  describe("edge cases", () => {
    it("rejects one missing either clock, since a fade cannot be sized without them", () => {
      expect(isPartialCaptureMessage({ type: "blk-partial-capture", videoId: "a", trackSeconds: 237 })).toBe(false);
      expect(isPartialCaptureMessage({ type: "blk-partial-capture", videoId: "a", coveredSeconds: 56.6 })).toBe(false);
    });

    it("rejects one without a videoId, so bytes are never bound to the wrong track", () => {
      expect(isPartialCaptureMessage({ ...partial, videoId: undefined })).toBe(false);
    });
  });

  describe("invariants", () => {
    it("is never mistaken for capture-ready, which is the one that sends a track off to be separated", () => {
      expect(isCaptureReadyMessage(partial)).toBe(false);
      const ready: CaptureReadyMessage = { type: "blk-capture-ready", videoId: partial.videoId };
      expect(isPartialCaptureMessage(ready)).toBe(false);
    });
  });
});
