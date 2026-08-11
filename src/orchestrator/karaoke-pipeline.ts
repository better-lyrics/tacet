// -- ISOLATED-world karaoke pipeline orchestrator ----------------------------

import { decodeOpusToPcm } from "@/cache/opus-codec";
import {
  type CaptureStandDownMessage,
  type RequestCapturedAudioMessage,
  type RequestNextPrefetchMessage,
  type RequestPrefetchMessage,
  isCaptureReadyMessage,
  isCapturedAudioMessage,
  isCapturedAudioUnavailableMessage,
  isDownloadProgressMessage,
  isNextTrackMessage,
} from "@/capture/bridge-protocol";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import {
  BETTER_LYRICS_PLAYER_EVENT,
  durationForTrack,
  playerStateFromBetterLyrics,
  playerStateFromOwnBridge,
} from "@/orchestrator/player-source";
import type { PlayerState } from "@/orchestrator/player-source";
import { decideShortStems, judgeStemCoverage, stemDurationSeconds } from "@/orchestrator/stem-coverage";
import { NEUTRAL_MIX_LEVEL } from "@/pageworld/gain-law";
import type { LoadStemsMessage, SetMixLevelMessage, StopStemsMessage } from "@/pageworld/protocol";
import { base64ToBytes, bytesToBase64 } from "@/relay/base64";
import { type ChunkAssembler, createChunkAssembler, splitIntoChunks } from "@/relay/chunk-transfer";
import { loadSettingsFrom } from "@/settings/storage";
import { createLogger } from "@/shared/logger";
import type {
  CancelSeparationCommand,
  CaptureChunkMessage,
  ForgetTrackCommand,
  ProbeCacheCommand,
  StemChunkMessage,
} from "../../workers/protocol2";
import {
  isCacheHitMessage,
  isCacheMissMessage,
  isStemChunkMessage,
  isTrackDoneMessage,
  isTrackErrorMessage,
  isTrackProgressMessage,
  isTrackStageMessage,
} from "../../workers/protocol2";

const CAPTURE_REQUEST_TIMEOUT_MS = 8000;
const ACQUISITION_WATCHDOG_MS = 8000;

const logger = createLogger("orchestrator");

function log(message: string): void {
  logger.log(message);
}

function logError(message: string, error: unknown): void {
  logger.error(message, error);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface KaraokePipelineOptions {
  onStateChange(state: KaraokeState): void;
}

// What the popup shows in its Coming up band. cached is null until the probe
// answers, so the band can say nothing rather than guess.
interface ComingUp {
  videoId: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  cached: boolean | null;
}

interface KaraokePipeline {
  engage(mixLevel: number): void;
  comingUp(): ComingUp | null;
  destroy(): void;
}

function createKaraokePipeline(options: KaraokePipelineOptions): KaraokePipeline {
  let state: KaraokeState = initialKaraokeState("");
  let pendingMixLevel = NEUTRAL_MIX_LEVEL;
  let comingUp: ComingUp | null = null;
  let prefetchVideoId: string | null = null;
  let vocalsAssembler: ChunkAssembler | null = null;
  let instrumentalAssembler: ChunkAssembler | null = null;
  let doneReceived = false;
  let cacheProbeTimer: ReturnType<typeof setTimeout> | null = null;
  let observedTrack: PlayerState | null = null;
  const reacquiredVideoIds = new Set<string>();

  // Unlike every later transition, the initial state never reaches setState below, so it is announced here.
  options.onStateChange(state);

  function setState(next: KaraokeState): void {
    if (next === state) return;
    state = next;
    options.onStateChange(state);
  }

  function dispatch(event: Parameters<typeof reduceKaraokeState>[1]): void {
    setState(reduceKaraokeState(state, event));
  }

  function resetStemAssembly(): void {
    vocalsAssembler = null;
    instrumentalAssembler = null;
    doneReceived = false;
  }

  function postToPageWorld(
    message:
      | SetMixLevelMessage
      | LoadStemsMessage
      | StopStemsMessage
      | CaptureStandDownMessage
      | RequestPrefetchMessage
      | RequestNextPrefetchMessage,
    transfer?: Transferable[]
  ): void {
    window.postMessage(message, window.location.origin, transfer);
  }

  // -- Track change polling -----------------------------------------------

  function onTrackObserved(observed: PlayerState): void {
    observedTrack = observed;
    const { videoId } = observed;
    if (videoId === state.videoId) return;

    log(`track changed ${state.videoId || "(none)"} -> ${videoId}`);

    if (state.status === "processing") {
      const cancel: CancelSeparationCommand = { type: "blk-cancel-separation" };
      chrome.runtime.sendMessage(cancel).catch(error => logError("failed to send cancel", error));
    }
    if (state.status === "processing" || state.status === "engaged") {
      postToPageWorld({ type: "blk-stop-stems" });
    }

    resetStemAssembly();
    prefetchVideoId = null;
    dispatch({ type: "track-changed", videoId });
    probeCacheFor(videoId);
  }

  function clearCacheProbeTimer(): void {
    if (cacheProbeTimer !== null) clearTimeout(cacheProbeTimer);
    cacheProbeTimer = null;
  }

  function probeCacheFor(videoId: string): void {
    const probe: ProbeCacheCommand = { type: "blk-probe-cache", videoId };
    chrome.runtime.sendMessage(probe).catch(error => logError("failed to send cache probe", error));

    if (videoId === state.videoId) armAcquisitionWatchdog(videoId);
  }

  function armAcquisitionWatchdog(videoId: string): void {
    clearCacheProbeTimer();
    cacheProbeTimer = setTimeout(() => {
      cacheProbeTimer = null;
      if (videoId !== state.videoId || state.status !== "waiting-for-capture") return;
      log(`still waiting on ${videoId}, asking again`);
      postToPageWorld({ type: "blk-request-prefetch", videoId });
      probeCacheFor(videoId);
    }, ACQUISITION_WATCHDOG_MS);
  }

  function trackDurationSeconds(videoId: string): number {
    return durationForTrack(observedTrack, videoId);
  }

  function forgetAndReacquire(videoId: string): void {
    reacquiredVideoIds.add(videoId);
    resetStemAssembly();
    dispatch({ type: "reacquire", videoId });
    const forget: ForgetTrackCommand = { type: "blk-forget-track", videoId };
    chrome.runtime
      .sendMessage(forget)
      .catch(error => logError("failed to send a forget-track command", error))
      .finally(() => {
        if (videoId !== state.videoId) return;
        postToPageWorld({ type: "blk-request-prefetch", videoId, fresh: true });
      });
  }

  function onBetterLyricsPlayerState(event: Event): void {
    const observed = playerStateFromBetterLyrics((event as CustomEvent).detail);
    if (observed) onTrackObserved(observed);
  }
  document.addEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyricsPlayerState);

  // -- MAIN world: capture-spike.ts ---------------------------------------

  async function sendCapturedAudioChunks(videoId: string, mimeType: string, bytes: ArrayBuffer): Promise<void> {
    const base64 = bytesToBase64(new Uint8Array(bytes));
    const chunks = splitIntoChunks(base64);
    log(`sending captured audio for ${videoId}: ${bytes.byteLength} bytes as ${chunks.length} chunk(s)`);

    for (let index = 0; index < chunks.length; index++) {
      if (videoId !== state.videoId && videoId !== prefetchVideoId) return; // superseded mid-send
      const message: CaptureChunkMessage = {
        type: "blk-capture-chunk",
        videoId,
        mimeType,
        index,
        total: chunks.length,
        data: chunks[index],
      };
      await chrome.runtime.sendMessage(message).catch(error => {
        throw error instanceof Error ? error : new Error(describeError(error));
      });
    }
  }

  function onWindowMessage(event: MessageEvent): void {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data: unknown = event.data;

    const observed = playerStateFromOwnBridge(data);
    if (observed) {
      onTrackObserved(observed);
      return;
    }

    if (isNextTrackMessage(data)) {
      // The artwork arrives in a second announcement for the same track, so a
      // repeat is an update rather than a new track.
      comingUp =
        data.videoId === comingUp?.videoId
          ? { ...comingUp, artworkUrl: data.artworkUrl ?? comingUp.artworkUrl }
          : {
              videoId: data.videoId,
              title: data.title ?? null,
              artist: data.artist ?? null,
              artworkUrl: data.artworkUrl ?? null,
              cached: null,
            };
      if (data.videoId === state.videoId) return;
      prefetchVideoId = data.videoId;
      log(`next up is ${data.videoId}, checking whether it needs separating`);
      probeCacheFor(data.videoId);
      return;
    }

    if (isCaptureReadyMessage(data)) {
      if (data.videoId === prefetchVideoId) {
        log(`next track ${data.videoId} acquired, separating it ahead of time`);
        const request: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId: data.videoId };
        window.postMessage(request, window.location.origin);
        return;
      }
      log(`capture ready for ${data.videoId}`);
      dispatch({ type: "capture-ready", videoId: data.videoId });
      maybeAutoEngage(data.videoId);
      return;
    }

    if (isDownloadProgressMessage(data)) {
      dispatch({ type: "download-progress", videoId: data.videoId, fraction: data.fraction, source: data.source });
      return;
    }

    if (isCapturedAudioMessage(data)) {
      sendCapturedAudioChunks(data.videoId, data.mimeType, data.bytes).catch(error => {
        logError("failed to upload captured audio", error);
        dispatch({ type: "failed", videoId: data.videoId, reason: describeError(error) });
      });
      return;
    }

    if (isCapturedAudioUnavailableMessage(data)) {
      log(`captured audio unavailable for ${data.videoId}: ${data.reason}`);
      dispatch({ type: "failed", videoId: data.videoId, reason: data.reason });
    }
  }
  window.addEventListener("message", onWindowMessage);

  // -- chrome.runtime: relayed from the offscreen document ----------------

  function handleStemChunk(message: StemChunkMessage): void {
    if (message.videoId !== state.videoId) return; // stale: superseded by a track change

    if (message.stem === "vocals") {
      vocalsAssembler ??= createChunkAssembler();
      addChunkSafely(vocalsAssembler, message);
    } else {
      instrumentalAssembler ??= createChunkAssembler();
      addChunkSafely(instrumentalAssembler, message);
    }

    finishStemsIfReady(message.videoId);
  }

  function addChunkSafely(assembler: ChunkAssembler, message: StemChunkMessage): void {
    try {
      assembler.addChunk(message.index, message.total, message.data);
    } catch (error) {
      dispatch({ type: "failed", videoId: message.videoId, reason: describeError(error) });
    }
  }

  function decodeStemBlob(assembler: ChunkAssembler): Blob {
    return new Blob([base64ToBytes(assembler.assemble())]);
  }

  function finishStemsIfReady(videoId: string): void {
    if (!doneReceived || !vocalsAssembler?.isComplete() || !instrumentalAssembler?.isComplete()) return;
    if (videoId !== state.videoId || state.status !== "processing") return;

    const vocalsBlob = decodeStemBlob(vocalsAssembler);
    const instrumentalBlob = decodeStemBlob(instrumentalAssembler);
    resetStemAssembly();

    log(`stems received for ${videoId}, decoding`);
    Promise.all([decodeOpusToPcm(vocalsBlob), decodeOpusToPcm(instrumentalBlob)])
      .then(([vocals, instrumental]) => {
        if (videoId !== state.videoId) return;

        const stemSeconds = stemDurationSeconds(vocals.channels[0]?.length ?? 0, vocals.sampleRate);
        const trackSeconds = trackDurationSeconds(videoId);
        const fit = judgeStemCoverage(stemSeconds, trackSeconds);
        const step = decideShortStems(fit, reacquiredVideoIds.has(videoId));
        const measured = `${stemSeconds.toFixed(1)}s of stems against a ${trackSeconds.toFixed(1)}s track`;

        if (step === "reacquire") {
          logError("stems are shorter than the track, capturing it again", new Error(measured));
          forgetAndReacquire(videoId);
          return;
        }
        if (step === "fail") {
          logError("stems are still too short after a fresh capture", new Error(measured));
          dispatch({ type: "failed", videoId, reason: "Only part of this track could be separated." });
          return;
        }
        if (fit !== "fits") log(`using slightly short stems for ${videoId}: ${measured}`);

        log(`stems decoded for ${videoId}, loading into the playback graph`);
        const transfer = [...vocals.channels, ...instrumental.channels].map(channel => channel.buffer);
        const message: LoadStemsMessage = {
          type: "blk-load-stems",
          videoId,
          vocals: vocals.channels,
          instrumental: instrumental.channels,
          sampleRate: vocals.sampleRate,
        };
        postToPageWorld(message, transfer);
        dispatch({ type: "stems-loaded", videoId });
        postToPageWorld({ type: "blk-set-mix-level", mixLevel: pendingMixLevel });
        log(`karaoke engaged for ${videoId}`);
        const nextRequest: RequestNextPrefetchMessage = { type: "blk-request-next-prefetch", videoId };
        postToPageWorld(nextRequest);
      })
      .catch(error => {
        logError("failed to decode stems", error);
        dispatch({ type: "failed", videoId, reason: describeError(error) });
      });
  }

  function noteComingUpCached(videoId: string, cached: boolean): void {
    if (comingUp?.videoId !== videoId) return;
    comingUp = { ...comingUp, cached };
  }

  function onRuntimeMessage(message: unknown): void {
    if (isCacheHitMessage(message)) {
      noteComingUpCached(message.videoId, true);
      if (message.videoId === prefetchVideoId) {
        log(`next track ${message.videoId} is already separated`);
        prefetchVideoId = null;
        return;
      }
      log(`cached stems found for ${message.videoId}, capture is not needed`);
      if (message.videoId === state.videoId) clearCacheProbeTimer();
      dispatch({ type: "cache-hit", videoId: message.videoId });
      postToPageWorld({ type: "blk-capture-stand-down", videoId: message.videoId });
      finishStemsIfReady(message.videoId);
      return;
    }
    if (isCacheMissMessage(message)) {
      noteComingUpCached(message.videoId, false);
      if (message.videoId === prefetchVideoId) {
        log(`next track ${message.videoId} is not separated yet, warming it`);
        postToPageWorld({ type: "blk-request-prefetch", videoId: message.videoId, ahead: true });
        return;
      }
      if (message.videoId !== state.videoId) return;
      clearCacheProbeTimer();
      log(`no cached stems for ${message.videoId}, acquiring`);
      postToPageWorld({ type: "blk-request-prefetch", videoId: message.videoId });
      return;
    }
    if (isTrackStageMessage(message)) {
      log(`stage for ${message.videoId}: ${message.stage}`);
      dispatch({ type: "stage", videoId: message.videoId, stage: message.stage });
      return;
    }
    if (isTrackProgressMessage(message)) {
      dispatch({ type: "progress", videoId: message.videoId, processed: message.processed, total: message.total });
      return;
    }
    if (isStemChunkMessage(message)) {
      handleStemChunk(message);
      return;
    }
    if (isTrackDoneMessage(message)) {
      log(`all stems delivered for ${message.videoId}`);
      doneReceived = true;
      finishStemsIfReady(message.videoId);
      return;
    }
    if (isTrackErrorMessage(message)) {
      logError(`pipeline failed for ${message.videoId}: ${message.code}`, message.message);
      dispatch({ type: "failed", videoId: message.videoId, reason: message.message });
    }
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // -- Kicking the pipeline off from the fader -----------------------------

  function requestCapturedAudio(videoId: string): void {
    const message: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId };
    window.postMessage(message, window.location.origin);

    setTimeout(() => {
      if (state.videoId === videoId && state.status === "processing" && state.stage === null) {
        log(`timed out waiting for a response for ${videoId}`);
        dispatch({ type: "failed", videoId, reason: "Timed out waiting for the captured track." });
      }
    }, CAPTURE_REQUEST_TIMEOUT_MS);
  }

  // -- Auto separate -------------------------------------------------------

  function maybeAutoEngage(videoId: string): void {
    loadSettingsFrom(chrome.storage.sync)
      .then(settings => {
        const armed = pendingMixLevel !== NEUTRAL_MIX_LEVEL;
        if (!settings.autoSeparateEnabled && !armed) return;
        if (videoId !== state.videoId || state.status !== "ready-to-engage") return;

        log(`auto-separating ${videoId}`);
        dispatch({ type: "engage", videoId });
        requestCapturedAudio(videoId);
      })
      .catch(error => logError("failed to read the auto-separate setting", error));
  }

  function engage(mixLevel: number): void {
    pendingMixLevel = mixLevel;
    postToPageWorld({ type: "blk-set-mix-level", mixLevel });

    if (mixLevel === NEUTRAL_MIX_LEVEL) return;
    if (state.status !== "ready-to-engage") return;

    const videoId = state.videoId;
    log(`engaging karaoke for ${videoId}`);
    dispatch({ type: "engage", videoId });
    requestCapturedAudio(videoId);
  }

  function destroy(): void {
    clearCacheProbeTimer();
    document.removeEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyricsPlayerState);
    window.removeEventListener("message", onWindowMessage);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);

    postToPageWorld({ type: "blk-stop-stems" });
    if (state.status === "processing") {
      const cancel: CancelSeparationCommand = { type: "blk-cancel-separation" };
      chrome.runtime.sendMessage(cancel).catch(error => logError("failed to send cancel", error));
    }
  }

  return { engage, comingUp: () => comingUp, destroy };
}

export { createKaraokePipeline };
export type { KaraokePipeline, KaraokePipelineOptions, ComingUp };
