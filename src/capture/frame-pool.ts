import { log } from "@/capture/log";
import type { SlicePlan } from "@/capture/slice-plan";
import { buildMintUrl, buildWorkerUrl } from "@/capture/worker-frame";
import { isMintedUrlMessage, isSliceCapturedMessage } from "@/capture/bridge-protocol";

interface CapturedSlice {
  index: number;
  startSeconds: number;
  reachedSeconds: number;
  trackDurationSeconds: number;
  mimeType: string;
  bytes: ArrayBuffer;
}

interface SliceCaptureOptions {
  videoId: string;
  slices: SlicePlan[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onSliceDone?: (done: number, total: number) => void;
}

const FRAME_ID_PREFIX = "blyrics-karaoke-worker-";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const FRAME_STYLE =
  "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;border:0;z-index:-1";

function createWorkerFrame(videoId: string, slice: SlicePlan): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.id = `${FRAME_ID_PREFIX}${slice.index}`;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText = FRAME_STYLE;
  frame.src = buildWorkerUrl(videoId, slice);
  return frame;
}

function captureTrackInSlices(options: SliceCaptureOptions): Promise<CapturedSlice[]> {
  const { videoId, slices, timeoutMs = DEFAULT_TIMEOUT_MS, signal, onSliceDone } = options;

  return new Promise(resolve => {
    if (slices.length === 0) {
      resolve([]);
      return;
    }

    const collected = new Map<number, CapturedSlice>();
    const frames = slices.map(slice => createWorkerFrame(videoId, slice));
    let settled = false;

    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      for (const frame of frames) frame.remove();
      const result = [...collected.values()]
        .filter(slice => slice.bytes.byteLength > 0)
        .sort((a, b) => a.index - b.index);
      log(`slice capture ${reason}: ${result.length}/${slices.length} slices for videoId=${videoId}`);
      resolve(result);
    };

    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (!isSliceCapturedMessage(data) || data.videoId !== videoId) return;
      if (collected.has(data.index)) return;

      collected.set(data.index, {
        index: data.index,
        startSeconds: data.startSeconds,
        reachedSeconds: data.reachedSeconds,
        trackDurationSeconds: data.trackDurationSeconds,
        mimeType: data.mimeType,
        bytes: data.bytes,
      });
      onSliceDone?.(collected.size, slices.length);
      if (collected.size === slices.length) finish("complete");
    }

    function onAbort(): void {
      collected.clear();
      finish("aborted");
    }

    const timer = setTimeout(() => finish("timed out"), timeoutMs);

    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    for (const frame of frames) document.body.appendChild(frame);
    log(`spawned ${frames.length} worker frames for videoId=${videoId}`);
  });
}

// -- Minting a url in a frame that dies straight afterwards ---------------------

interface MintedUrl {
  videoId: string;
  url: string;
  trackDurationSeconds: number;
}

interface MintUrlOptions {
  videoId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const MINT_FRAME_ID = `${FRAME_ID_PREFIX}mint`;
const DEFAULT_MINT_TIMEOUT_MS = 3 * 60 * 1000;

function mintUrlInFrame(options: MintUrlOptions): Promise<MintedUrl | null> {
  const { videoId, timeoutMs = DEFAULT_MINT_TIMEOUT_MS, signal } = options;

  return new Promise(resolve => {
    const existing = document.getElementById(MINT_FRAME_ID);
    if (existing) existing.remove();

    const frame = document.createElement("iframe");
    frame.id = MINT_FRAME_ID;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.allow = "autoplay";
    frame.style.cssText = FRAME_STYLE;
    frame.src = buildMintUrl(videoId);

    const startedAt = Date.now();
    let settled = false;

    const finish = (minted: MintedUrl | null, reason: string): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      frame.remove();
      log(`minting frame for videoId=${videoId} ${reason} after ${Date.now() - startedAt} ms`);
      resolve(minted);
    };

    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (!isMintedUrlMessage(data) || data.videoId !== videoId) return;
      finish({ videoId: data.videoId, url: data.url, trackDurationSeconds: data.trackDurationSeconds }, "answered");
    }

    function onAbort(): void {
      finish(null, "was abandoned");
    }

    const timer = setTimeout(() => finish(null, "timed out"), timeoutMs);

    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    document.body.appendChild(frame);
  });
}

export { captureTrackInSlices, FRAME_ID_PREFIX, MINT_FRAME_ID, mintUrlInFrame };
export type { CapturedSlice, MintedUrl, MintUrlOptions, SliceCaptureOptions };
