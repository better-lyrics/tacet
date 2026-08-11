import type { PlasmoCSConfig } from "plasmo";
import { DEFAULT_MAX_RETAINED_BYTES, createCaptureAccumulator } from "@/capture/accumulator";
import { isAdPlaying } from "@/capture/ad-state";
import type {
  CaptureReadyMessage,
  CapturedAudioMessage,
  CapturedAudioUnavailableMessage,
  DownloadProgressMessage,
  NextTrackMessage,
  PartialCaptureMessage,
  PrefetchedAudioMessage,
} from "@/capture/bridge-protocol";
import {
  isCaptureStandDownMessage,
  isRequestCapturedAudioMessage,
  isRequestNextPrefetchMessage,
  isRequestPrefetchMessage,
  isRequestPrefetchedAudioMessage,
} from "@/capture/bridge-protocol";
import { computeBufferedFraction } from "@/capture/buffered-fraction";
import { decideRetry, judgeCapture, missingSeconds, retryDelayMs, shouldHoldCapture } from "@/capture/capture-coverage";
import { bufferedRangeEnd } from "@/capture/edge-hopper";
import type { DownloadSource } from "@/orchestrator/download-tooltip";
import { concatenateChunks, countInitSegments, planFirstPlusMedia } from "@/capture/decode-plan";
import { runCaptureDecodeExperiment } from "@/capture/decode-experiment";
import { log, logError } from "@/capture/log";
import { FRAME_ID_PREFIX, type CapturedSlice, captureTrackInSlices } from "@/capture/frame-pool";
import { installForcedSilence, silenceMediaIn } from "@/capture/silence-frame";
import { runSliceCapture } from "@/capture/slice-runner";
import { DEFAULT_WORKER_COUNT, planSlices, planWholeTrack } from "@/capture/slice-plan";
import { decidePrefetch } from "@/capture/prefetch-gate";
import { videoIdsToRelease } from "@/capture/prefetch-retention";
import { settledTrackDuration } from "@/capture/settled-duration";
import { isSetLoggingMessage } from "@/pageworld/protocol";
import { readClockDuration } from "@/pageworld/track-duration";
import { setLoggingEnabled } from "@/shared/logger";
import { installSourceBufferCapture } from "@/capture/sourcebuffer-patch";
import { nextVideoIdInQueue, readQueueItems } from "@/capture/next-track";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { readWorkerAssignment } from "@/capture/worker-frame";
import { selectPlaybackElement } from "@/pageworld/select-media-element";

// -- Track capture (MAIN world) ----------------------------------------------
export const config: PlasmoCSConfig = {
  matches: ["https://music.youtube.com/*"],
  run_at: "document_start",
  all_frames: true,
  world: "MAIN",
};

const ENDED_LISTENER_POLL_MS = 2000;
const FULLY_BUFFERED_EPSILON_S = 0.5;

const accumulator = createCaptureAccumulator();

// -- Which track is being listened to ----------------------------------------

let announcedListenedVideoId: string | null = null;

function listenedVideoId(): string | null {
  return announcedListenedVideoId ?? getVideoIdFromSearch(window.location.search);
}

const stoodDownVideoIds = new Set<string>();

function onAudioChunk(mimeType: string, bytes: Uint8Array): void {
  const videoId = listenedVideoId();
  if (videoId !== null && accumulator.setActiveVideoId(videoId)) {
    log(`capture reset for videoId=${videoId}`);
    if (stoodDownVideoIds.has(videoId)) accumulator.standDown();
  }

  const result = accumulator.addChunk(mimeType, bytes);
  if (result === "cap-hit") {
    log(
      `capture cap hit at ${DEFAULT_MAX_RETAINED_BYTES} bytes; further chunks are dropped from decode input but still counted in totals`
    );
  }
}

const isAdPlayingHere = (): boolean => isAdPlaying(document);

const capture = installSourceBufferCapture({ isAdPlaying: isAdPlayingHere, onAudioChunk });

// -- Worker frame mode -------------------------------------------------------

const workerAssignment = readWorkerAssignment(window.location.search);

const SILENCE_SWEEP_MS = 250;

if (workerAssignment) {
  if (!installForcedSilence(HTMLMediaElement.prototype)) {
    logError("worker frame could not be silenced, refusing to capture in it", new Error("no media setters"));
  }
  silenceMediaIn(document);
  setInterval(() => silenceMediaIn(document), SILENCE_SWEEP_MS);

  const workerVideoId = getVideoIdFromSearch(window.location.search);
  log(
    `worker frame for slice ${workerAssignment.index} [${workerAssignment.fromSeconds.toFixed(1)}s, ${workerAssignment.toSeconds.toFixed(1)}s)`
  );
  if (workerVideoId) {
    void runSliceCapture(accumulator, workerAssignment, workerVideoId).catch(error => {
      logError(`worker slice ${workerAssignment.index} crashed`, error);
    });
  }
}

const isTopFrame = window.top === window;
const runsOrchestration = isTopFrame && !workerAssignment;

// -- Capture completion ------------------------------------------------------

function currentVideoElement(): HTMLVideoElement | null {
  return selectPlaybackElement(Array.from(document.querySelectorAll("video")));
}

function runDecodeExperiment(): Promise<unknown> {
  const element = currentVideoElement();
  const videoDurationSeconds = element && Number.isFinite(element.duration) ? element.duration : null;
  return runCaptureDecodeExperiment(accumulator, videoDurationSeconds).catch(error => {
    logError("decode experiment crashed", error);
    throw error;
  });
}

function announceCaptureReady(videoId: string): void {
  const message: CaptureReadyMessage = { type: "blk-capture-ready", videoId };
  window.postMessage(message, window.location.origin);
  log(`capture-ready broadcast for videoId=${videoId}`);
}

function announcePartialCapture(videoId: string, coveredSeconds: number, trackSeconds: number): void {
  const message: PartialCaptureMessage = { type: "blk-partial-capture", videoId, coveredSeconds, trackSeconds };
  window.postMessage(message, window.location.origin);
  log(
    `partial-capture broadcast for videoId=${videoId}, ${coveredSeconds.toFixed(1)}s of ${trackSeconds.toFixed(1)}s, too short to separate`
  );
}

let listenedElement: HTMLVideoElement | null = null;
const announcedKeys = new Set<string>();

function announceKey(videoId: string, durationSeconds: number): string {
  return `${videoId}:${Math.round(durationSeconds)}`;
}

function trackDurationSeconds(element: HTMLVideoElement): number | null {
  return settledTrackDuration(element.duration, readClockDuration(document));
}

function announceIfCaptureComplete(element: HTMLVideoElement): void {
  const stats = accumulator.getStats();
  if (!stats.videoId || stats.retainedChunkCount === 0) return;
  if (stoodDownVideoIds.has(stats.videoId)) return;
  if (hiddenPlayerOwns(stats.videoId)) return;
  if (isAdPlayingHere()) return;

  const duration = trackDurationSeconds(element);
  if (duration === null) {
    logStaleElement(stats.videoId, element);
    return;
  }

  const key = announceKey(stats.videoId, duration);
  if (announcedKeys.has(key)) return;
  announcedKeys.add(key);
  announceCaptureReady(stats.videoId);
}

let staleElementNotice: string | null = null;

function logStaleElement(videoId: string, element: HTMLVideoElement): void {
  const clockSeconds = readClockDuration(document);
  if (!Number.isFinite(element.duration) || !Number.isFinite(clockSeconds)) return;
  const notice = `${videoId}:${Math.round(element.duration)}`;
  if (staleElementNotice === notice) return;
  staleElementNotice = notice;
  log(
    `capture-ready withheld for videoId=${videoId}: the element still reports ${element.duration.toFixed(1)}s against the player bar's ${clockSeconds.toFixed(1)}s`
  );
}

function isFullyBuffered(element: HTMLVideoElement): boolean {
  if (!Number.isFinite(element.duration) || element.duration <= 0) return false;
  if (element.buffered.length === 0) return false;
  return bufferedRangeEnd(element.buffered, 0) >= element.duration - FULLY_BUFFERED_EPSILON_S;
}

function bufferedEndSeconds(element: HTMLVideoElement): number {
  return element.buffered.length === 0 ? 0 : element.buffered.end(element.buffered.length - 1);
}

function announceDownloadProgress(element: HTMLVideoElement): void {
  const videoId = listenedVideoId();
  if (!videoId || stoodDownVideoIds.has(videoId) || isAdPlayingHere()) return;
  if (prefetchStateByVideoId.get(videoId) === "done") return;
  const prefetching = hiddenPlayerOwns(videoId);
  const source: DownloadSource = prefetching ? "hidden-player" : "listener-playback";
  const against = trackDurationSeconds(element) ?? readClockDuration(document);
  const fraction = prefetching ? hiddenPlayerProgress() : computeBufferedFraction(bufferedEndSeconds(element), against);
  const message: DownloadProgressMessage = { type: "blk-download-progress", videoId, fraction, source };
  window.postMessage(message, window.location.origin);
}

function pollCaptureCompletion(): void {
  const element = currentVideoElement();
  if (!element) return;

  if (element !== listenedElement) {
    listenedElement = element;
    element.addEventListener("ended", () => {
      log("track ended, running decode experiment");
      void runDecodeExperiment();
      announceIfCaptureComplete(element);
    });
  }

  announceDownloadProgress(element);
  if (isFullyBuffered(element)) announceIfCaptureComplete(element);
}

if (runsOrchestration) setInterval(pollCaptureCompletion, ENDED_LISTENER_POLL_MS);

// -- Hidden-player prefetch --------------------------------------------------

let slicedPrefetch: Promise<CapturedSlice[]> | null = null;
let slicedPrefetchVideoId: string | null = null;
let slicedPrefetchIsAhead = false;
let slicedPrefetchAbort: AbortController | null = null;

const PRODUCTION_WORKER_COUNT = 1;

const PREFETCH_DELAY_MS = 800;

interface PrefetchedTrack {
  mimeType: string;
  bytes: Uint8Array;
  complete: boolean;
  coveredSeconds: number;
  trackSeconds: number;
}

const prefetchedByVideoId = new Map<string, PrefetchedTrack>();

type PrefetchState = "running" | "retrying" | "done" | "unavailable";

function hiddenPlayerOwns(videoId: string): boolean {
  const state = prefetchStateByVideoId.get(videoId);
  return state === "running" || state === "retrying";
}
const prefetchStateByVideoId = new Map<string, PrefetchState>();

function hiddenPlayerProgress(): number {
  try {
    const frame = document.querySelector<HTMLIFrameElement>(`iframe[id^="${FRAME_ID_PREFIX}"]`);
    const video = frame?.contentDocument?.querySelector("video");
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return Number.NaN;
    return computeBufferedFraction(video.currentTime, video.duration);
  } catch (error) {
    logError("could not read the hidden player's progress", error);
    return Number.NaN;
  }
}

function prefetchTrackInSlices(
  videoId: string,
  workerCount = DEFAULT_WORKER_COUNT,
  ahead = false
): Promise<CapturedSlice[]> {
  const decision = decidePrefetch({
    inFlightVideoId: slicedPrefetchVideoId,
    inFlightIsAhead: slicedPrefetchIsAhead,
    requestedVideoId: videoId,
    requestedIsAhead: ahead,
  });
  if (decision === "reuse" && slicedPrefetch) return slicedPrefetch;
  if (decision === "refuse") {
    log(`sliced prefetch for videoId=${videoId} refused: still capturing ${slicedPrefetchVideoId}`);
    return Promise.resolve([]);
  }
  if (decision === "supersede" && slicedPrefetchVideoId) {
    log(`sliced prefetch for videoId=${videoId} takes over from ${slicedPrefetchVideoId}`);
    prefetchStateByVideoId.delete(slicedPrefetchVideoId);
    slicedPrefetchAbort?.abort();
  }

  const element = currentVideoElement();
  const duration = element && Number.isFinite(element.duration) ? element.duration : 0;
  const slices = workerCount <= 1 ? planWholeTrack() : planSlices(duration, workerCount);
  if (slices.length === 0) {
    log("sliced prefetch skipped: no duration yet for a multi-worker plan");
    return Promise.resolve([]);
  }
  log(`sliced prefetch: ${slices.length} worker(s) for videoId=${videoId}`);

  const abort = new AbortController();
  slicedPrefetchVideoId = videoId;
  slicedPrefetchIsAhead = ahead;
  slicedPrefetchAbort = abort;
  slicedPrefetch = captureTrackInSlices({
    videoId,
    slices,
    signal: abort.signal,
    onSliceDone: (done, total) => log(`sliced prefetch progress ${done}/${total}`),
  }).finally(() => {
    if (slicedPrefetchAbort !== abort) return;
    slicedPrefetch = null;
    slicedPrefetchVideoId = null;
    slicedPrefetchAbort = null;
  });
  return slicedPrefetch;
}

const prefetchAttemptsByVideoId = new Map<string, number>();

function holdPrefetched(videoId: string, track: PrefetchedTrack): boolean {
  const held = prefetchedByVideoId.get(videoId);
  if (held && held.coveredSeconds >= track.coveredSeconds) {
    log(
      `keeping the ${held.coveredSeconds.toFixed(1)}s held for videoId=${videoId} over a ${track.coveredSeconds.toFixed(1)}s retry`
    );
    return false;
  }

  prefetchedByVideoId.delete(videoId);
  prefetchedByVideoId.set(videoId, track);

  for (const released of videoIdsToRelease([...prefetchedByVideoId.keys()])) {
    const bytes = prefetchedByVideoId.get(released)?.bytes.byteLength ?? 0;
    prefetchedByVideoId.delete(released);
    prefetchStateByVideoId.delete(released);
    prefetchAttemptsByVideoId.delete(released);
    log(`released ${bytes} captured bytes held for videoId=${released}`);
  }
  return true;
}

function abandonPrefetch(videoId: string, ahead: boolean, reason: string): void {
  const attempts = (prefetchAttemptsByVideoId.get(videoId) ?? 0) + 1;
  prefetchAttemptsByVideoId.set(videoId, attempts);

  if (decideRetry(attempts, ahead) === "give-up") {
    prefetchStateByVideoId.set(videoId, "unavailable");
    log(`prefetch for videoId=${videoId} gave up after ${attempts} attempt(s): ${reason}`);
    return;
  }

  const delay = retryDelayMs(attempts);
  prefetchStateByVideoId.set(videoId, "retrying");
  log(`prefetch for videoId=${videoId} attempt ${attempts} ${reason}, retrying in ${delay}ms`);
  window.setTimeout(() => {
    if (prefetchStateByVideoId.get(videoId) !== "retrying") return;
    prefetchStateByVideoId.delete(videoId);
    startPrefetchFor(videoId, { ahead });
  }, delay);
}

function startPrefetchFor(videoId: string, { ahead = false, fresh = false } = {}): void {
  if (fresh) {
    log(`discarding the capture held for videoId=${videoId} and acquiring it again`);
    prefetchedByVideoId.delete(videoId);
    prefetchStateByVideoId.delete(videoId);
    prefetchAttemptsByVideoId.delete(videoId);
    stoodDownVideoIds.delete(videoId);
    announcedKeys.clear();
  }
  if (prefetchStateByVideoId.get(videoId) === "done" && prefetchedByVideoId.has(videoId)) {
    if (!stoodDownVideoIds.has(videoId)) announceCaptureReady(videoId);
    return;
  }
  const pending = prefetchStateByVideoId.get(videoId);
  if (!ahead && (pending === "unavailable" || pending === "retrying")) {
    prefetchStateByVideoId.delete(videoId);
    prefetchAttemptsByVideoId.delete(videoId);
  }
  if (prefetchStateByVideoId.has(videoId) || stoodDownVideoIds.has(videoId)) return;
  prefetchStateByVideoId.set(videoId, "running");

  window.setTimeout(() => {
    if (stoodDownVideoIds.has(videoId)) {
      log(`prefetch skipped for videoId=${videoId}, its stems are already cached`);
      prefetchStateByVideoId.set(videoId, "done");
      return;
    }
    if (!ahead && listenedVideoId() !== videoId) {
      prefetchStateByVideoId.delete(videoId);
      return;
    }

    log(`prefetching videoId=${videoId} in a hidden player${ahead ? ", ahead of the listener" : ""}`);
    void prefetchTrackInSlices(videoId, PRODUCTION_WORKER_COUNT, ahead)
      .then(slices => {
        if (prefetchStateByVideoId.get(videoId) !== "running") {
          log(`prefetch for videoId=${videoId} was superseded, dropping what it captured`);
          return;
        }
        const captured = slices[0];
        const coverage = {
          reachedSeconds: captured?.reachedSeconds ?? Number.NaN,
          trackDurationSeconds: captured?.trackDurationSeconds ?? Number.NaN,
          byteLength: captured?.bytes.byteLength ?? 0,
        };
        const verdict = judgeCapture(coverage);
        const complete = verdict === "complete";

        if (captured && shouldHoldCapture(coverage)) {
          const took = holdPrefetched(videoId, {
            mimeType: captured.mimeType,
            bytes: new Uint8Array(captured.bytes),
            complete,
            coveredSeconds: captured.reachedSeconds,
            trackSeconds: captured.trackDurationSeconds,
          });
          if (took && !complete)
            announcePartialCapture(videoId, captured.reachedSeconds, captured.trackDurationSeconds);
        }

        if (!complete || !captured) {
          const short = verdict === "short";
          abandonPrefetch(
            videoId,
            ahead,
            short ? `stopped ${missingSeconds(coverage).toFixed(1)}s short of the track` : "captured nothing usable"
          );
          return;
        }

        prefetchStateByVideoId.set(videoId, "done");
        log(
          `prefetch complete for videoId=${videoId}, ${captured.bytes.byteLength} bytes covering ${captured.trackDurationSeconds.toFixed(1)}s`
        );
        if (stoodDownVideoIds.has(videoId)) return;
        announceCaptureReady(videoId);
      })
      .catch(error => {
        if (prefetchStateByVideoId.get(videoId) !== "running") return;
        logError(`prefetch failed for videoId=${videoId}`, error);
        abandonPrefetch(videoId, ahead, "threw");
      });
  }, PREFETCH_DELAY_MS);
}

// -- Handing the bytes over --------------------------------------------------

function respondToCapturedAudioRequest(videoId: string): void {
  const prefetched = prefetchedByVideoId.get(videoId);
  if (prefetched && !prefetched.complete) {
    log(
      `not serving the ${prefetched.coveredSeconds.toFixed(1)}s held for videoId=${videoId} to separation, it would cache ${prefetched.trackSeconds.toFixed(1)}s of stems as a partial track`
    );
  }
  if (prefetched?.complete) {
    const bytes = prefetched.bytes.slice();
    const message: CapturedAudioMessage = {
      type: "blk-captured-audio",
      videoId,
      mimeType: prefetched.mimeType,
      bytes: bytes.buffer,
    };
    const byteLength = bytes.byteLength;
    window.postMessage(message, window.location.origin, [bytes.buffer]);
    log(`prefetched audio sent for videoId=${videoId}, bytes=${byteLength}`);
    return;
  }

  const stats = accumulator.getStats();

  if (stats.videoId !== videoId || stats.retainedChunkCount === 0) {
    const reason = stats.videoId !== videoId ? "captured audio is for a different track" : "no audio captured yet";
    const message: CapturedAudioUnavailableMessage = { type: "blk-captured-audio-unavailable", videoId, reason };
    window.postMessage(message, window.location.origin);
    log(`captured-audio-unavailable for videoId=${videoId}: ${reason}`);
    return;
  }

  const chunks = accumulator.getChunks();
  const initSegments = countInitSegments(chunks);
  if (initSegments > 1) log(`capture saw ${initSegments} initializations for videoId=${videoId}, keeping the first`);
  const bytes = concatenateChunks(planFirstPlusMedia(chunks));
  const byteLength = bytes.byteLength;
  const message: CapturedAudioMessage = {
    type: "blk-captured-audio",
    videoId,
    mimeType: stats.mimeTypes[0] ?? "audio/webm",
    bytes: bytes.buffer,
  };
  window.postMessage(message, window.location.origin, [bytes.buffer]);
  log(`captured-audio sent for videoId=${videoId}, bytes=${byteLength}`);
}

function respondToPrefetchedAudioRequest(videoId: string): void {
  const prefetched = prefetchedByVideoId.get(videoId);
  if (!prefetched) {
    log(
      `prefetched-audio request for videoId=${videoId} went unanswered: holding [${[...prefetchedByVideoId.keys()].join(", ")}]`
    );
    return;
  }

  const bytes = prefetched.bytes.slice();
  const byteLength = bytes.byteLength;
  const message: PrefetchedAudioMessage = {
    type: "blk-prefetched-audio",
    videoId,
    bytes: bytes.buffer,
  };
  window.postMessage(message, window.location.origin, [bytes.buffer]);
  log(`prefetched-audio sent for videoId=${videoId}, bytes=${byteLength}`);
}

function standDownFor(videoId: string): void {
  if (stoodDownVideoIds.has(videoId)) return;
  stoodDownVideoIds.add(videoId);
  if (accumulator.getStats().videoId !== videoId) return;
  const retainedBefore = accumulator.getStats().retainedChunkCount;
  accumulator.standDown();
  log(`capture stood down for videoId=${videoId}, dropped ${retainedBefore} retained chunk(s)`);
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data: unknown = event.data;
  if (isSetLoggingMessage(data)) setLoggingEnabled(data.enabled);
  if (isRequestCapturedAudioMessage(data)) respondToCapturedAudioRequest(data.videoId);
  if (isRequestPrefetchedAudioMessage(data) && runsOrchestration) respondToPrefetchedAudioRequest(data.videoId);
  if (isRequestPrefetchMessage(data) && runsOrchestration) {
    if (data.ahead !== true) announcedListenedVideoId = data.videoId;
    startPrefetchFor(data.videoId, { ahead: data.ahead === true, fresh: data.fresh === true });
  }

  if (isRequestNextPrefetchMessage(data) && runsOrchestration) {
    const next = nextVideoIdInQueue(readQueueItems(document), data.videoId);
    if (!next) {
      log(`no next track in the queue after ${data.videoId}`);
      return;
    }
    const message: NextTrackMessage = { type: "blk-next-track", videoId: next };
    window.postMessage(message, window.location.origin);
  }
  if (isCaptureStandDownMessage(data)) standDownFor(data.videoId);
});

declare global {
  interface Window {
    blkRunCaptureDecodeExperiment: () => Promise<unknown>;
    blkDisableCapture: () => void;
    blkPrefetchTrackInSlices: (workerCount?: number) => Promise<unknown>;
    blkCaptureProbe: () => unknown;
  }
}

window.blkCaptureProbe = () => {
  const videoId = listenedVideoId();
  return {
    videoId,
    prefetchState: videoId ? prefetchStateByVideoId.get(videoId) ?? null : null,
    hiddenPlayerOwnsCurrent: videoId ? hiddenPlayerOwns(videoId) : false,
    attempts: videoId ? prefetchAttemptsByVideoId.get(videoId) ?? 0 : 0,
    capturedBytes: videoId ? prefetchedByVideoId.get(videoId)?.bytes.byteLength ?? 0 : 0,
    inFlightVideoId: slicedPrefetchVideoId,
    inFlightIsAhead: slicedPrefetchIsAhead,
    workerFrames: Array.from(document.querySelectorAll<HTMLIFrameElement>(`iframe[id^="${FRAME_ID_PREFIX}"]`)).map(
      frame => frame.id
    ),
    states: Object.fromEntries(prefetchStateByVideoId),
  };
};

window.blkPrefetchTrackInSlices = async (workerCount?: number) => {
  const started = performance.now();
  const videoId = listenedVideoId();
  if (!videoId) return { slices: [], elapsedMs: 0 };
  const slices = await prefetchTrackInSlices(videoId, workerCount);
  return {
    slices: slices.map(slice => ({
      index: slice.index,
      startSeconds: +slice.startSeconds.toFixed(2),
      bytes: slice.bytes.byteLength,
      mimeType: slice.mimeType,
    })),
    totalBytes: slices.reduce((sum, slice) => sum + slice.bytes.byteLength, 0),
    elapsedMs: Math.round(performance.now() - started),
  };
};

window.blkRunCaptureDecodeExperiment = runDecodeExperiment;
window.blkDisableCapture = () => {
  capture.restore();
  log("capture disabled: appendBuffer and addSourceBuffer restored to their originals");
};

log("installed; call window.blkRunCaptureDecodeExperiment() on demand, or let a track finish");
