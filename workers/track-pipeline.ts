import { acquireFromMintedUrl } from "../src/acquisition/acquire.js";
import type { AcquiredTrack } from "../src/acquisition/acquire.js";
import type { SabrTransport } from "../src/acquisition/sabr-client.js";
import { decideCacheLookup } from "../src/orchestrator/cache-lookup.js";
import { decideSeparationStart, shouldRepublishStage } from "../src/orchestrator/separation-gate.js";
import { createRegionAccumulator } from "../src/orchestrator/region-accumulator.js";
import { base64ToBytes, bytesToBase64 } from "../src/relay/base64.js";
import { type ChunkAssembler, createChunkAssembler, splitIntoChunks } from "../src/relay/chunk-transfer.js";
import { computeContentKey, deleteVideoIdAlias, getContentKeyForVideoId, setVideoIdAlias } from "../src/cache/keys.js";
import { hasCachedModel } from "../src/cache/model-cache.js";
import { encodePcmToOpus } from "../src/cache/opus-codec.js";
import { deleteEntries, getStemRecord, putStemRecord } from "../src/cache/stem-store.js";
import type { StemRecord } from "../src/cache/stem-store.js";
import { decodeFileToFloat32 } from "../src/separation/audio-codec.js";

// -- Signal tracing -------------------------------------------------------
function stageRms(channel: Float32Array | undefined): string {
  if (!channel || channel.length === 0) return "no-data";
  let sum = 0;
  for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / channel.length).toExponential(3);
}
import {
  type CaptureChunkMessage,
  type ModelChoice,
  type StemChunkMessage,
  type StemName,
  type TrackPipelineOutboundMessage,
  type TrackStage,
} from "./protocol2.js";
import { SeparationHost } from "./separation-host.js";
import { createLogger } from "../src/shared/logger.js";

const logger = createLogger("pipeline");

// -- Offscreen-side track pipeline -------------------------------------------

const TARGET_CHANNEL_COUNT = 2;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function post(message: TrackPipelineOutboundMessage): void {
  chrome.runtime.sendMessage(message).catch(error => {
    logger.error("failed to send", message.type, error);
  });
}

async function sendStemChunks(videoId: string, stem: StemName, blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = splitIntoChunks(bytesToBase64(bytes));
  for (let index = 0; index < chunks.length; index++) {
    const message: StemChunkMessage = {
      type: "blk-stem-chunk",
      videoId,
      stem,
      index,
      total: chunks.length,
      data: chunks[index],
    };
    try {
      await chrome.runtime.sendMessage(message);
    } catch (error) {
      logger.error("failed to send stem chunk", stem, index, error);
      throw error instanceof Error ? error : new Error(toErrorMessage(error));
    }
  }
}

interface DecodedTrack {
  channels: Float32Array[];
  sampleRate: number;
  numFrames: number;
}

class TrackPipeline {
  private activeVideoId: string | null = null;
  private runningVideoId: string | null = null;
  private currentStage: TrackStage | null = null;
  private lastProgress: { processed: number; total: number } | null = null;
  private captureAssembler: ChunkAssembler | null = null;
  private captureMimeType = "";

  private republishProgress(videoId: string): void {
    if (shouldRepublishStage(this.currentStage)) {
      post({ type: "blk-track-stage", videoId, stage: this.currentStage as TrackStage });
    }
    if (this.lastProgress !== null) {
      post({ type: "blk-track-progress", videoId, ...this.lastProgress });
    }
  }

  constructor(
    private separationHost: SeparationHost,
    private getCacheBudgetBytes: () => number,
    private getModelChoice: () => ModelChoice
  ) {}

  private isStale(videoId: string): boolean {
    return videoId !== this.activeVideoId;
  }

  private sendStage(videoId: string, stage: TrackStage): void {
    if (this.isStale(videoId)) return;
    this.currentStage = stage;
    post({ type: "blk-track-stage", videoId, stage });
  }

  private sendError(videoId: string, code: string, message: string): void {
    post({ type: "blk-track-error", videoId, code, message });
  }

  private claimTrack(videoId: string): void {
    if (videoId === this.activeVideoId) return;
    this.separationHost.cancel();
    this.activeVideoId = videoId;
    this.captureAssembler = null;
    this.captureMimeType = "";
  }

  private beginSeparation(videoId: string, mimeType: string, bytes: Uint8Array<ArrayBuffer>): void {
    const decision = decideSeparationStart(this.runningVideoId, videoId);
    if (decision === "ignore") {
      logger.log(`already separating ${videoId}, ignoring a second copy of it`);
      this.republishProgress(videoId);
      return;
    }
    if (decision === "supersede") this.separationHost.cancel();

    this.currentStage = null;
    this.lastProgress = null;
    this.runningVideoId = videoId;
    this.run(videoId, mimeType, bytes)
      .catch(error => {
        if (isAbortError(error)) return;
        this.sendError(videoId, "unknown", toErrorMessage(error));
      })
      .finally(() => {
        if (this.runningVideoId === videoId) this.runningVideoId = null;
      });
  }

  async acquireTrack(videoId: string, url: string, send?: SabrTransport): Promise<void> {
    this.claimTrack(videoId);

    let acquired: AcquiredTrack;
    try {
      acquired = await acquireFromMintedUrl({ url, send });
    } catch (error) {
      this.sendAcquireFailed(videoId, toErrorMessage(error));
      return;
    }
    if (this.isStale(videoId)) return;

    if (!acquired.ok || acquired.bytes.length === 0) {
      this.sendAcquireFailed(videoId, acquired.reason);
      return;
    }

    logger.log(
      `pulled ${acquired.bytes.length} bytes of ${videoId} over ${acquired.requests} request(s) as ${acquired.mimeType}`
    );
    this.beginSeparation(videoId, acquired.mimeType, acquired.bytes);
  }

  private sendAcquireFailed(videoId: string, reason: string): void {
    logger.log(`could not pull ${videoId} from the url it was given: ${reason}`);
    post({ type: "blk-acquire-failed", videoId, reason });
  }

  handleCaptureChunk(message: CaptureChunkMessage): void {
    this.claimTrack(message.videoId);
    if (!this.captureAssembler) {
      this.captureAssembler = createChunkAssembler();
      this.captureMimeType = message.mimeType;
    }

    try {
      this.captureAssembler.addChunk(message.index, message.total, message.data);
    } catch (error) {
      this.sendError(message.videoId, "chunk-transfer-failed", toErrorMessage(error));
      return;
    }

    if (!this.captureAssembler.isComplete()) return;

    const base64 = this.captureAssembler.assemble();
    const mimeType = this.captureMimeType;
    this.captureAssembler = null;
    this.captureMimeType = "";

    this.beginSeparation(message.videoId, mimeType, base64ToBytes(base64));
  }

  async forgetTrack(videoId: string): Promise<void> {
    const contentKey = await getContentKeyForVideoId(videoId);
    await deleteVideoIdAlias(videoId);
    if (contentKey) await deleteEntries([contentKey]);
    logger.log(`forgot ${videoId}${contentKey ? ` and its stems under ${contentKey.slice(0, 12)}` : ""}`);
  }

  async probeCache(videoId: string): Promise<boolean> {
    this.activeVideoId = videoId;

    const miss = (): boolean => {
      if (!this.isStale(videoId)) post({ type: "blk-cache-miss", videoId });
      return false;
    };

    const contentKey = await getContentKeyForVideoId(videoId);
    if (!contentKey) return miss();
    if (this.isStale(videoId)) return false;

    const record = await getStemRecord(contentKey);
    if (!record) return miss();
    if (this.isStale(videoId)) return false;
    if (decideCacheLookup(record, null) !== "alias-hit") return miss();

    post({ type: "blk-cache-hit", videoId });
    this.sendStage(videoId, "checking-cache");
    await this.deliver(videoId, record);
    return true;
  }

  cancelActive(): void {
    this.separationHost.cancel();
    this.activeVideoId = null;
    this.runningVideoId = null;
    this.captureAssembler = null;
    this.captureMimeType = "";
  }

  private async run(videoId: string, mimeType: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    this.sendStage(videoId, "checking-cache");
    const aliasContentKey = await getContentKeyForVideoId(videoId);
    if (this.isStale(videoId)) return;

    const aliasRecord = aliasContentKey ? await getStemRecord(aliasContentKey) : null;
    if (this.isStale(videoId)) return;

    if (aliasRecord && decideCacheLookup(aliasRecord, null) === "alias-hit") {
      await this.deliver(videoId, aliasRecord);
      return;
    }

    this.sendStage(videoId, "decoding");
    const decoded = await decodeFileToFloat32(new Blob([bytes], { type: mimeType }));
    logger.log(
      `decoded input: frames=${decoded.numFrames}, rate=${decoded.sampleRate}, rms=${stageRms(decoded.channels[0])}`
    );
    if (this.isStale(videoId)) return;

    if (decoded.channels.length !== TARGET_CHANNEL_COUNT) {
      this.sendError(
        videoId,
        "decode-failed",
        `Expected ${TARGET_CHANNEL_COUNT} decoded channels, got ${decoded.channels.length}.`
      );
      return;
    }

    const contentKey = await computeContentKey(bytes);
    if (this.isStale(videoId)) return;

    const contentRecord = await getStemRecord(contentKey);
    if (this.isStale(videoId)) return;

    if (contentRecord && decideCacheLookup(aliasRecord, contentRecord) === "content-hit") {
      await setVideoIdAlias(videoId, contentKey);
      if (this.isStale(videoId)) return;
      await this.deliver(videoId, contentRecord);
      return;
    }

    await this.separate(videoId, contentKey, decoded);
  }

  private async separate(videoId: string, contentKey: string, decoded: DecodedTrack): Promise<void> {
    const model = this.getModelChoice();
    this.sendStage(videoId, (await hasCachedModel(model.modelUrl)) ? "loading-model" : "downloading-model");
    if (this.isStale(videoId)) return;

    await this.separationHost.init(model);
    if (this.isStale(videoId)) return;

    this.sendStage(videoId, "separating");
    const accumulator = createRegionAccumulator(decoded.numFrames, decoded.channels.length);
    let loggedRegions = 0;

    await this.separationHost.process({
      channels: decoded.channels,
      totalFrames: decoded.numFrames,
      onProgress: (processed, total) => {
        if (this.isStale(videoId)) return;
        this.lastProgress = { processed, total };
        post({ type: "blk-track-progress", videoId, processed, total });
      },
      onRegion: region => {
        if (loggedRegions < 3) {
          loggedRegions++;
          logger.log(
            `region @${region.regionStart}: vocals=${stageRms(region.vocals[0])}, instrumental=${stageRms(
              region.instrumental[0]
            )}, frames=${region.vocals[0]?.length ?? 0}`
          );
        }
        accumulator.addRegion(region.regionStart, region.vocals, region.instrumental);
      },
    });
    if (this.isStale(videoId)) return;

    this.sendStage(videoId, "encoding");
    logger.log(
      `accumulated: vocals=${stageRms(accumulator.vocals[0])}, instrumental=${stageRms(accumulator.instrumental[0])}`
    );
    const [vocalsBlob, instrumentalBlob] = await Promise.all([
      encodePcmToOpus(accumulator.vocals, decoded.sampleRate),
      encodePcmToOpus(accumulator.instrumental, decoded.sampleRate),
    ]);
    if (this.isStale(videoId)) return;

    await putStemRecord(
      contentKey,
      {
        vocals: vocalsBlob,
        instrumental: instrumentalBlob,
        framesDone: decoded.numFrames,
        totalFrames: decoded.numFrames,
      },
      this.getCacheBudgetBytes()
    );
    await setVideoIdAlias(videoId, contentKey);
    if (this.isStale(videoId)) return;

    await this.deliverBlobs(videoId, vocalsBlob, instrumentalBlob);
  }

  private async deliver(videoId: string, record: Pick<StemRecord, "vocals" | "instrumental">): Promise<void> {
    await this.deliverBlobs(videoId, record.vocals, record.instrumental);
  }

  private async deliverBlobs(videoId: string, vocals: Blob, instrumental: Blob): Promise<void> {
    await sendStemChunks(videoId, "vocals", vocals);
    if (this.isStale(videoId)) return;
    await sendStemChunks(videoId, "instrumental", instrumental);
    if (this.isStale(videoId)) return;
    post({ type: "blk-track-done", videoId });
  }
}

export { TrackPipeline };
