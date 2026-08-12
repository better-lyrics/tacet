import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { bytesToBase64 } from "../src/relay/base64.js";
import type { CaptureChunkMessage, ModelChoice, TrackPipelineOutboundMessage } from "./protocol2.js";
import type { SeparationHost } from "./separation-host.js";
import { TrackPipeline } from "./track-pipeline.js";
import { encodeMessage } from "../src/acquisition/protobuf.js";
import { UMP_PART } from "../src/acquisition/ump.js";
import { getContentKeyForVideoId, setVideoIdAlias } from "../src/cache/keys.js";
import { getStemRecord, putStemRecord } from "../src/cache/stem-store.js";

const posted: TrackPipelineOutboundMessage[] = [];
let cancelCount = 0;

const TEST_MODEL: ModelChoice = { modelUrl: "https://models.example.com/htdemucs.onnx", modelSha256: "a".repeat(64) };

function fakeSeparationHost(): SeparationHost {
  return {
    cancel(): void {
      cancelCount++;
    },
    async init(): Promise<void> {},
    async process(): Promise<void> {},
    dispose(): void {},
  } as unknown as SeparationHost;
}

function captureChunk(videoId: string): CaptureChunkMessage {
  return {
    type: "blk-capture-chunk",
    videoId,
    mimeType: "audio/webm",
    index: 0,
    total: 1,
    data: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
  };
}

function runsStartedFor(videoId: string): number {
  return posted.filter(
    message => message.type === "blk-track-stage" && message.videoId === videoId && message.stage === "checking-cache"
  ).length;
}

beforeEach(() => {
  posted.length = 0;
  cancelCount = 0;
  indexedDB = new IDBFactory();
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message: TrackPipelineOutboundMessage) => {
        posted.push(message);
        return undefined;
      },
    },
  } as unknown as typeof chrome;
});

describe("TrackPipeline separation gating", () => {
  it("starts a separation for a completed capture", async () => {
    const pipeline = new TrackPipeline(
      fakeSeparationHost(),
      () => 250 * 1024 * 1024,
      () => TEST_MODEL
    );
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    await Promise.resolve();

    expect(runsStartedFor("DJCB1ZlseJ8")).toBe(1);
  });

  describe("regressions", () => {
    it("regression: ignores a second capture for the track already separating", async () => {
      const pipeline = new TrackPipeline(
        fakeSeparationHost(),
        () => 250 * 1024 * 1024,
        () => TEST_MODEL
      );
      pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
      pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
      await Promise.resolve();

      expect(runsStartedFor("DJCB1ZlseJ8")).toBe(1);
    });
  });

  it("supersedes a run the listener has moved off", async () => {
    const pipeline = new TrackPipeline(
      fakeSeparationHost(),
      () => 250 * 1024 * 1024,
      () => TEST_MODEL
    );
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    pipeline.handleCaptureChunk(captureChunk("lYBUbBu4W08"));
    await Promise.resolve();

    expect(cancelCount).toBeGreaterThan(0);
    expect(runsStartedFor("lYBUbBu4W08")).toBe(1);
  });

  it("takes a new capture once the previous run has settled", async () => {
    const pipeline = new TrackPipeline(
      fakeSeparationHost(),
      () => 250 * 1024 * 1024,
      () => TEST_MODEL
    );
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    await new Promise(resolve => setTimeout(resolve, 50));
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    await Promise.resolve();

    expect(runsStartedFor("DJCB1ZlseJ8")).toBe(2);
  });

  describe("invariants", () => {
    it("never runs two separations at once, however many captures arrive", async () => {
      const pipeline = new TrackPipeline(
        fakeSeparationHost(),
        () => 250 * 1024 * 1024,
        () => TEST_MODEL
      );
      for (let index = 0; index < 5; index++) pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
      await Promise.resolve();

      expect(runsStartedFor("DJCB1ZlseJ8")).toBe(1);
    });
  });
});

describe("TrackPipeline forgetTrack", () => {
  const VIDEO_ID = "DJCB1ZlseJ8";
  const CONTENT_KEY = "4d3f9c0a1b2e";

  async function seedCachedStems(): Promise<void> {
    await putStemRecord(CONTENT_KEY, {
      vocals: new Blob([new Uint8Array([1, 2, 3])]),
      instrumental: new Blob([new Uint8Array([4, 5, 6])]),
      framesDone: 2_425_000,
      totalFrames: 2_425_000,
    });
    await setVideoIdAlias(VIDEO_ID, CONTENT_KEY);
  }

  function missesFor(videoId: string): number {
    return posted.filter(message => message.type === "blk-cache-miss" && message.videoId === videoId).length;
  }

  it("drops the stems and the alias", async () => {
    await seedCachedStems();
    expect(await getContentKeyForVideoId(VIDEO_ID)).toBe(CONTENT_KEY);
    expect(await getStemRecord(CONTENT_KEY)).not.toBeNull();

    await new TrackPipeline(
      fakeSeparationHost(),
      () => 250 * 1024 * 1024,
      () => TEST_MODEL
    ).forgetTrack(VIDEO_ID);

    expect(await getContentKeyForVideoId(VIDEO_ID)).toBeNull();
    expect(await getStemRecord(CONTENT_KEY)).toBeNull();
  });

  it("leaves the next probe missing, so the track is acquired again", async () => {
    await seedCachedStems();
    const pipeline = new TrackPipeline(
      fakeSeparationHost(),
      () => 250 * 1024 * 1024,
      () => TEST_MODEL
    );

    expect(await pipeline.probeCache(VIDEO_ID)).toBe(true);
    posted.length = 0;

    await pipeline.forgetTrack(VIDEO_ID);

    expect(await pipeline.probeCache(VIDEO_ID)).toBe(false);
    expect(missesFor(VIDEO_ID)).toBe(1);
  });

  describe("edge cases", () => {
    it("is safe for a track that was never cached", async () => {
      const pipeline = new TrackPipeline(
        fakeSeparationHost(),
        () => 250 * 1024 * 1024,
        () => TEST_MODEL
      );
      await expect(pipeline.forgetTrack("lYBUbBu4W08")).resolves.toBeUndefined();
    });

    it("leaves another track's stems alone", async () => {
      await seedCachedStems();
      await setVideoIdAlias("lYBUbBu4W08", "someOtherKey");

      await new TrackPipeline(
        fakeSeparationHost(),
        () => 250 * 1024 * 1024,
        () => TEST_MODEL
      ).forgetTrack(VIDEO_ID);

      expect(await getContentKeyForVideoId("lYBUbBu4W08")).toBe("someOtherKey");
    });
  });
});

describe("TrackPipeline answering a duplicate capture", () => {
  const VIDEO_ID = "DJCB1ZlseJ8";

  function stagesFor(videoId: string) {
    return posted.flatMap(message =>
      message.type === "blk-track-stage" && message.videoId === videoId ? [message.stage] : []
    );
  }

  it("regression: tells a second asker where the running separation has got to", async () => {
    const pipeline = new TrackPipeline(
      fakeSeparationHost(),
      () => 250 * 1024 * 1024,
      () => TEST_MODEL
    );
    pipeline.handleCaptureChunk(captureChunk(VIDEO_ID));
    await new Promise(resolve => setTimeout(resolve, 20));

    const before = stagesFor(VIDEO_ID).length;
    expect(before).toBeGreaterThan(0);

    pipeline.handleCaptureChunk(captureChunk(VIDEO_ID));
    await new Promise(resolve => setTimeout(resolve, 20));

    const after = stagesFor(VIDEO_ID);
    expect(after.length).toBeGreaterThan(before);
    expect(after[after.length - 1]).toBe(after[before - 1]);
  });

  it("does not start a second separation to answer", async () => {
    const pipeline = new TrackPipeline(
      fakeSeparationHost(),
      () => 250 * 1024 * 1024,
      () => TEST_MODEL
    );
    pipeline.handleCaptureChunk(captureChunk(VIDEO_ID));
    pipeline.handleCaptureChunk(captureChunk(VIDEO_ID));
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(runsStartedFor(VIDEO_ID)).toBe(1);
  });
});

// -- Acquiring a track from a minted url ----------------------------------------

const ACQUIRED_VIDEO_ID = "DJCB1ZlseJ8";
const MINTED_URL = "https://rr3.googlevideo.com/videoplayback?itag=251&clen=4&dur=188.3&mime=audio%2Fwebm&c=WEB_REMIX";

function umpPart(type: number, payload: Uint8Array): Uint8Array {
  return new Uint8Array([type, payload.length, ...payload]);
}

function wholeTrackResponse(media: number[]): Uint8Array {
  const header = umpPart(
    UMP_PART.mediaHeader,
    encodeMessage([
      { number: 1, varint: 1 },
      { number: 6, varint: 0 },
      { number: 9, varint: 1 },
      { number: 12, varint: 5_000 },
    ])
  );
  const body = umpPart(UMP_PART.media, new Uint8Array([1, ...media]));
  return new Uint8Array([...header, ...body]);
}

function newPipeline(): TrackPipeline {
  return new TrackPipeline(
    fakeSeparationHost(),
    () => 250 * 1024 * 1024,
    () => TEST_MODEL
  );
}

function failuresFor(videoId: string): TrackPipelineOutboundMessage[] {
  return posted.filter(message => message.type === "blk-acquire-failed" && message.videoId === videoId);
}

describe("TrackPipeline acquisition", () => {
  it("separates a track it pulled from a minted url", async () => {
    const pipeline = newPipeline();
    await pipeline.acquireTrack(ACQUIRED_VIDEO_ID, MINTED_URL, async () => ({
      status: 200,
      bytes: wholeTrackResponse([1, 2, 3, 4]),
    }));
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(failuresFor(ACQUIRED_VIDEO_ID)).toHaveLength(0);
    expect(runsStartedFor(ACQUIRED_VIDEO_ID)).toBe(1);
  });

  it("shares the supersede decision with the capture route rather than starting a second run", async () => {
    const pipeline = newPipeline();
    const send = async () => ({ status: 200, bytes: wholeTrackResponse([1, 2, 3, 4]) });
    await pipeline.acquireTrack(ACQUIRED_VIDEO_ID, MINTED_URL, send);
    pipeline.handleCaptureChunk(captureChunk(ACQUIRED_VIDEO_ID));
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(runsStartedFor(ACQUIRED_VIDEO_ID)).toBe(1);
  });

  describe("edge cases", () => {
    it("reports a refusal so the ladder can try the next source, without failing the track", async () => {
      const pipeline = newPipeline();
      await pipeline.acquireTrack(ACQUIRED_VIDEO_ID, MINTED_URL, async () => ({
        status: 403,
        bytes: new Uint8Array(),
      }));

      expect(failuresFor(ACQUIRED_VIDEO_ID)).toHaveLength(1);
      expect(posted.filter(message => message.type === "blk-track-error")).toHaveLength(0);
      expect(runsStartedFor(ACQUIRED_VIDEO_ID)).toBe(0);
    });

    it("reports a url it cannot read rather than pulling nothing in silence", async () => {
      const pipeline = newPipeline();
      await pipeline.acquireTrack(ACQUIRED_VIDEO_ID, "https://example.com/not-a-stream");

      expect(failuresFor(ACQUIRED_VIDEO_ID)).toHaveLength(1);
      expect(runsStartedFor(ACQUIRED_VIDEO_ID)).toBe(0);
    });

    it("reports a transport that throws rather than letting the ladder wait for ever", async () => {
      const pipeline = newPipeline();
      await pipeline.acquireTrack(ACQUIRED_VIDEO_ID, MINTED_URL, async () => {
        throw new Error("the network is gone");
      });

      expect(failuresFor(ACQUIRED_VIDEO_ID)).toHaveLength(1);
      expect(runsStartedFor(ACQUIRED_VIDEO_ID)).toBe(0);
    });

    it("drops a pull the listener has already moved on from", async () => {
      const pipeline = newPipeline();
      const pulling = pipeline.acquireTrack(ACQUIRED_VIDEO_ID, MINTED_URL, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return { status: 200, bytes: wholeTrackResponse([1, 2, 3, 4]) };
      });
      pipeline.handleCaptureChunk(captureChunk("other-track"));
      await pulling;
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(runsStartedFor(ACQUIRED_VIDEO_ID)).toBe(0);
      expect(failuresFor(ACQUIRED_VIDEO_ID)).toHaveLength(0);
    });
  });
});
