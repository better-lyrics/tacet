// -- ISOLATED-world karaoke pipeline orchestrator ----------------------------

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
import { decideCrossfadeLanding } from "@/orchestrator/crossfade-landing";
import type { LandingKind } from "@/orchestrator/crossfade-landing";
import {
  BETTER_LYRICS_PLAYER_EVENT,
  durationForTrack,
  playerStateFromBetterLyrics,
  playerStateFromOwnBridge,
} from "@/orchestrator/player-source";
import type { PlayerState } from "@/orchestrator/player-source";
import { createLogger } from "@/shared/logger";
import { NEUTRAL_MIX_LEVEL } from "@/pageworld/gain-law";
import { decodeOpusToPcm } from "@/cache/opus-codec";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import { decideShortStems, judgeStemCoverage, stemDurationSeconds } from "@/orchestrator/stem-coverage";
import {
  type LoadStemsMessage,
  type SetMixLevelMessage,
  type StageDeckMessage,
  type StagedReadyMessage,
  type SetCrossfadeMessage,
  type StopStemsMessage,
  isCrossfadeAbortedMessage,
  isCrossfadeStartedMessage,
  isRequestStagedDeckMessage,
} from "@/pageworld/protocol";
import { loadSettingsFrom } from "@/settings/storage";
import { base64ToBytes, bytesToBase64 } from "@/relay/base64";
import { type ChunkAssembler, createChunkAssembler, splitIntoChunks } from "@/relay/chunk-transfer";
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
const CROSSFADE_ARM_GRACE_SECONDS = 6;

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
  onCrossfadeStarted(durationSeconds: number): void;
}

interface KaraokePipeline {
  engage(mixLevel: number): void;
  setCrossfadeSeconds(seconds: number): void;
  destroy(): void;
}

function createKaraokePipeline(options: KaraokePipelineOptions): KaraokePipeline {
  let state: KaraokeState = initialKaraokeState("");
  let pendingMixLevel = NEUTRAL_MIX_LEVEL;
  let prefetchVideoId: string | null = null;
  let vocalsAssembler: ChunkAssembler | null = null;
  let instrumentalAssembler: ChunkAssembler | null = null;
  let doneReceived = false;
  let staged: { videoId: string; vocals: Blob; instrumental: Blob } | null = null;
  let stagedVocals: ChunkAssembler | null = null;
  let stagedInstrumental: ChunkAssembler | null = null;
  let stagedDoneReceived = false;
  let crossfadingInto: string | null = null;
  let crossfadingIntoKind: LandingKind = "stems";
  let crossfadeArmTimer: ReturnType<typeof setTimeout> | null = null;
  let cacheProbeTimer: ReturnType<typeof setTimeout> | null = null;
  let observedTrack: PlayerState | null = null;
  const reacquiredVideoIds = new Set<string>();

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

  function armCrossfade(videoId: string, durationSeconds: number, kind: LandingKind): void {
    disarmCrossfade();
    crossfadingInto = videoId;
    crossfadingIntoKind = kind;
    log(`crossfading into ${videoId} over ${durationSeconds} s of ${kind}`);
    crossfadeArmTimer = setTimeout(
      () => {
        if (crossfadingInto !== videoId) return;
        log(`the transition into ${videoId} never landed, disarming`);
        disarmCrossfade();
      },
      (durationSeconds + CROSSFADE_ARM_GRACE_SECONDS) * 1000
    );
  }

  function disarmCrossfade(): void {
    if (crossfadeArmTimer !== null) clearTimeout(crossfadeArmTimer);
    crossfadeArmTimer = null;
    crossfadingInto = null;
    crossfadingIntoKind = "stems";
  }

  function resetStaging(): void {
    staged = null;
    stagedVocals = null;
    stagedInstrumental = null;
    stagedDoneReceived = false;
  }

  function postToPageWorld(
    message:
      | SetMixLevelMessage
      | LoadStemsMessage
      | StopStemsMessage
      | CaptureStandDownMessage
      | RequestPrefetchMessage
      | RequestNextPrefetchMessage
      | StagedReadyMessage
      | StageDeckMessage
      | SetCrossfadeMessage,
    transfer?: Transferable[]
  ): void {
    window.postMessage(message, window.location.origin, transfer);
  }

  // -- Track change polling -----------------------------------------------

  function onTrackObserved(observed: PlayerState): void {
    observedTrack = observed;
    const { videoId } = observed;
    if (videoId === state.videoId) return;

    if (videoId === crossfadingInto) {
      const landing = decideCrossfadeLanding({ kind: crossfadingIntoKind, status: state.status });
      disarmCrossfade();
      resetStemAssembly();
      resetStaging();
      prefetchVideoId = null;

      if (landing === "release") {
        log(`crossfaded into ${videoId} while karaoke was ${state.status}, handing the audio back`);
        postToPageWorld({ type: "blk-stop-stems" });
        dispatch({ type: "track-changed", videoId });
        probeCacheFor(videoId);
        return;
      }

      if (landing === "keep-deck-and-reacquire") {
        log(`crossfaded into ${videoId} on unseparated audio, separating it while it plays`);
        dispatch({ type: "track-changed", videoId });
        probeCacheFor(videoId);
        requestNextPrefetch(videoId);
        return;
      }

      log(`crossfaded into ${videoId}, its stems are already in the deck`);
      dispatch({ type: "crossfaded", videoId });
      requestNextPrefetch(videoId);
      return;
    }

    log(`track changed ${state.videoId || "(none)"} -> ${videoId}`);

    if (state.status === "processing") {
      const cancel: CancelSeparationCommand = { type: "blk-cancel-separation" };
      chrome.runtime.sendMessage(cancel).catch(error => logError("failed to send cancel", error));
    }
    if (state.status === "processing" || state.status === "engaged") {
      postToPageWorld({ type: "blk-stop-stems" });
    }

    resetStemAssembly();
    resetStaging();
    prefetchVideoId = null;
    dispatch({ type: "track-changed", videoId });
    probeCacheFor(videoId);
  }

  function clearCacheProbeTimer(): void {
    if (cacheProbeTimer !== null) clearTimeout(cacheProbeTimer);
    cacheProbeTimer = null;
  }

  function requestNextPrefetch(videoId: string): void {
    const request: RequestNextPrefetchMessage = { type: "blk-request-next-prefetch", videoId };
    postToPageWorld(request);
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
      maybeAcquireCurrent(videoId);
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
      if (videoId !== state.videoId && videoId !== prefetchVideoId) return;
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

    if (isRequestStagedDeckMessage(data)) {
      sendStagedDeck(data.videoId);
      return;
    }

    if (isCrossfadeStartedMessage(data)) {
      if (data.kind === undefined) {
        logError(
          "a crossfade started without naming what it faded in",
          new Error(`assuming stems for ${data.videoId}, so an unseparated track would never be separated`)
        );
      }
      armCrossfade(data.videoId, data.durationSeconds, data.kind ?? "stems");
      options.onCrossfadeStarted(data.durationSeconds);
      return;
    }

    if (isCrossfadeAbortedMessage(data)) {
      if (data.videoId !== null && data.videoId !== crossfadingInto) return;
      log(`the transition into ${data.videoId ?? "the staged track"} was unwound: ${data.reason}`);
      disarmCrossfade();
      return;
    }

    if (isNextTrackMessage(data)) {
      if (data.videoId === state.videoId || data.videoId === prefetchVideoId) return;
      resetStaging();
      prefetchVideoId = data.videoId;
      log(`next up is ${data.videoId}, checking whether it needs separating`);
      probeCacheFor(data.videoId);
      return;
    }

    if (isCaptureReadyMessage(data)) {
      if (data.videoId === prefetchVideoId) {
        maybeSeparateAhead(data.videoId);
        return;
      }
      log(`capture ready for ${data.videoId}`);
      dispatch({ type: "capture-ready", videoId: data.videoId });
      if (data.videoId === state.videoId && prefetchVideoId === null) requestNextPrefetch(data.videoId);
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

  // -- Staging the next track ---------------------------------------------

  function isStagingTarget(videoId: string): boolean {
    return videoId === prefetchVideoId && videoId !== state.videoId;
  }

  function stageStemChunk(message: StemChunkMessage): void {
    const target =
      message.stem === "vocals"
        ? (stagedVocals ??= createChunkAssembler())
        : (stagedInstrumental ??= createChunkAssembler());
    try {
      target.addChunk(message.index, message.total, message.data);
    } catch (error) {
      logError(`could not stage ${message.stem} for ${message.videoId}`, error);
      resetStaging();
      return;
    }
    finishStagingIfReady(message.videoId);
  }

  function finishStagingIfReady(videoId: string): void {
    if (!stagedDoneReceived || !stagedVocals?.isComplete() || !stagedInstrumental?.isComplete()) return;

    const vocals = decodeStemBlob(stagedVocals);
    const instrumental = decodeStemBlob(stagedInstrumental);
    stagedVocals = null;
    stagedInstrumental = null;
    stagedDoneReceived = false;
    staged = { videoId, vocals, instrumental };

    const kilobytes = Math.round((vocals.size + instrumental.size) / 1024);
    log(`staged ${videoId} for a transition, ${kilobytes} kB of Opus held`);
    const ready: StagedReadyMessage = { type: "blk-staged-ready", videoId };
    postToPageWorld(ready);
  }

  function sendStagedDeck(videoId: string): void {
    const held = staged;
    if (!held || held.videoId !== videoId) {
      log(`the page world asked for ${videoId} but nothing is staged under it`);
      return;
    }

    Promise.all([decodeOpusToPcm(held.vocals), decodeOpusToPcm(held.instrumental)])
      .then(([vocals, instrumental]) => {
        if (staged?.videoId !== videoId) return;
        const message: StageDeckMessage = {
          type: "blk-stage-deck",
          videoId,
          vocals: vocals.channels,
          instrumental: instrumental.channels,
          sampleRate: vocals.sampleRate,
        };
        const frames = vocals.channels[0]?.length ?? 0;
        const transfer = [...vocals.channels, ...instrumental.channels].map(channel => channel.buffer);
        postToPageWorld(message, transfer);
        staged = null;
        log(`handed ${videoId} to the idle deck, ${frames} frames`);
      })
      .catch(error => {
        logError(`failed to decode the staged stems for ${videoId}`, error);
        resetStaging();
      });
  }

  function handleStemChunk(message: StemChunkMessage): void {
    if (isStagingTarget(message.videoId)) {
      stageStemChunk(message);
      return;
    }
    if (message.videoId !== state.videoId) return;

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
        requestNextPrefetch(videoId);
      })
      .catch(error => {
        logError("failed to decode stems", error);
        dispatch({ type: "failed", videoId, reason: describeError(error) });
      });
  }

  function onRuntimeMessage(message: unknown): void {
    if (isCacheHitMessage(message)) {
      if (isStagingTarget(message.videoId)) {
        log(`next track ${message.videoId} is already separated, staging it`);
        return;
      }
      log(`cached stems found for ${message.videoId}, capture is not needed`);
      if (message.videoId === state.videoId) {
        clearCacheProbeTimer();
        if (prefetchVideoId === null) requestNextPrefetch(message.videoId);
      }
      dispatch({ type: "cache-hit", videoId: message.videoId });
      postToPageWorld({ type: "blk-capture-stand-down", videoId: message.videoId });
      finishStemsIfReady(message.videoId);
      return;
    }
    if (isCacheMissMessage(message)) {
      if (message.videoId === prefetchVideoId) {
        log(`next track ${message.videoId} is not separated yet, warming it`);
        postToPageWorld({ type: "blk-request-prefetch", videoId: message.videoId, ahead: true });
        return;
      }
      if (message.videoId !== state.videoId) return;
      clearCacheProbeTimer();
      maybeAcquireCurrent(message.videoId);
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
      if (isStagingTarget(message.videoId)) {
        stagedDoneReceived = true;
        finishStagingIfReady(message.videoId);
        return;
      }
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

  function maybeAcquireCurrent(videoId: string): void {
    loadSettingsFrom(chrome.storage.sync)
      .then(settings => {
        if (videoId !== state.videoId) return;
        if (settings.autoSeparateEnabled || pendingMixLevel !== NEUTRAL_MIX_LEVEL) {
          log(`no cached stems for ${videoId}, acquiring`);
          postToPageWorld({ type: "blk-request-prefetch", videoId });
          return;
        }
        log(`not acquiring ${videoId}, separation is off and the fader is neutral`);
        if (prefetchVideoId === null) requestNextPrefetch(videoId);
      })
      .catch(error => logError("failed to read the auto-separate setting", error));
  }

  function maybeSeparateAhead(videoId: string): void {
    loadSettingsFrom(chrome.storage.sync)
      .then(settings => {
        if (videoId !== prefetchVideoId) return;
        if (!settings.autoSeparateEnabled && pendingMixLevel === NEUTRAL_MIX_LEVEL) {
          log(`next track ${videoId} acquired, held for a crossfade but not separated`);
          return;
        }
        if (state.status !== "engaged" && state.status !== "failed") {
          log(`next track ${videoId} acquired, waiting for ${state.videoId} to finish before separating it`);
          return;
        }
        log(`next track ${videoId} acquired, separating it ahead of time`);
        const request: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId };
        window.postMessage(request, window.location.origin);
      })
      .catch(error => logError("failed to read the auto-separate setting", error));
  }

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
    if (state.status === "waiting-for-capture") {
      log(`arming ${state.videoId}, acquiring it now that the fader asked for it`);
      postToPageWorld({ type: "blk-request-prefetch", videoId: state.videoId });
      return;
    }
    if (state.status !== "ready-to-engage") return;

    const videoId = state.videoId;
    log(`engaging karaoke for ${videoId}`);
    dispatch({ type: "engage", videoId });
    requestCapturedAudio(videoId);
  }

  function destroy(): void {
    clearCacheProbeTimer();
    disarmCrossfade();
    document.removeEventListener(BETTER_LYRICS_PLAYER_EVENT, onBetterLyricsPlayerState);
    window.removeEventListener("message", onWindowMessage);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);

    postToPageWorld({ type: "blk-stop-stems" });
    if (state.status === "processing") {
      const cancel: CancelSeparationCommand = { type: "blk-cancel-separation" };
      chrome.runtime.sendMessage(cancel).catch(error => logError("failed to send cancel", error));
    }
  }

  function setCrossfadeSeconds(seconds: number): void {
    postToPageWorld({ type: "blk-set-crossfade", seconds });
  }

  return { engage, setCrossfadeSeconds, destroy };
}

export { createKaraokePipeline };
export type { KaraokePipeline, KaraokePipelineOptions };
