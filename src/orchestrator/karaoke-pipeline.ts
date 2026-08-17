// -- ISOLATED-world karaoke pipeline orchestrator ----------------------------

import { enabledOrder, nextSource, sanitizeSourcePreferences } from "@/acquisition/sources";
import type { SourceId } from "@/acquisition/sources";
import { AheadStaging } from "@/orchestrator/ahead-staging";
import { decodeOpusToPcm } from "@/cache/opus-codec";
import { deliveredBy } from "@/orchestrator/delivery";
import {
  type CaptureStandDownMessage,
  type ListeningToMessage,
  type RequestCapturedAudioMessage,
  type RequestShadowUrlMessage,
  type RequestNextPrefetchMessage,
  type RequestPrefetchMessage,
  isAcquisitionResultMessage,
  isCaptureReadyMessage,
  isCapturedAudioMessage,
  isCapturedAudioUnavailableMessage,
  isDownloadProgressMessage,
  isNextTrackMessage,
} from "@/capture/bridge-protocol";
import { decideCrossfadeLanding } from "@/orchestrator/crossfade-landing";
import type { LandingKind } from "@/orchestrator/crossfade-landing";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";
import {
  BETTER_LYRICS_PLAYER_EVENT,
  durationForTrack,
  playerStateFromBetterLyrics,
  playerStateFromOwnBridge,
} from "@/orchestrator/player-source";
import type { PlayerState } from "@/orchestrator/player-source";
import { describeSeparationVeto, separationVeto } from "@/orchestrator/separation-wanted";
import type { SeparationVeto } from "@/orchestrator/separation-wanted";
import { decideShortStems, judgeStemCoverage, stemDurationSeconds } from "@/orchestrator/stem-coverage";
import { trackStatusStore } from "@/orchestrator/track-status-store";
import { NEUTRAL_MIX_LEVEL, faderArmed } from "@/pageworld/gain-law";
import {
  type LoadStemsMessage,
  type SetCrossfadeMessage,
  type SetMixLevelMessage,
  type StageDeckMessage,
  type StagedReadyMessage,
  type StopStemsMessage,
  isCrossfadeAbortedMessage,
  isCrossfadeStartedMessage,
  isRequestStagedDeckMessage,
} from "@/pageworld/protocol";
import { base64ToBytes, bytesToBase64 } from "@/relay/base64";
import { type ChunkAssembler, createChunkAssembler, splitIntoChunks } from "@/relay/chunk-transfer";
import type { Settings } from "@/settings/settings";
import { createLogger } from "@/shared/logger";
import type {
  AcquireTrackCommand,
  CancelSeparationCommand,
  CaptureChunkMessage,
  ForgetTrackCommand,
  ProbeCacheCommand,
  StemChunkMessage,
} from "../../workers/protocol2";
import {
  isAcquireFailedMessage,
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
  settings: Settings;
  onStateChange(state: KaraokeState): void;
  onCrossfadeStarted(durationSeconds: number): void;
}

interface KaraokePipeline {
  engage(mixLevel: number, glideSeconds?: number): void;
  setSettings(settings: Settings): void;
  setCrossfadeSeconds(seconds: number): void;
  deliveredSource(videoId: string): SourceId | null;
  destroy(): void;
}

function createKaraokePipeline(options: KaraokePipelineOptions): KaraokePipeline {
  let settings = options.settings;
  let state: KaraokeState = initialKaraokeState("");
  let pendingMixLevel = NEUTRAL_MIX_LEVEL;
  let prefetchVideoId: string | null = null;
  let warmAllowedFor: string | null = null;
  let vocalsAssembler: ChunkAssembler | null = null;
  let instrumentalAssembler: ChunkAssembler | null = null;
  let doneReceived = false;
  const aheadStaging = new AheadStaging();
  let crossfadingInto: string | null = null;
  let crossfadingIntoKind: LandingKind = "stems";
  let crossfadeArmTimer: ReturnType<typeof setTimeout> | null = null;
  let cacheProbeTimer: ReturnType<typeof setTimeout> | null = null;
  let observedTrack: PlayerState | null = null;
  let climb: { videoId: string; tried: SourceId[]; inFlight: boolean; exhausted: boolean } | null = null;
  let delivery: { videoId: string; source: SourceId } | null = null;
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
    aheadStaging.clear();
  }

  function postToPageWorld(
    message:
      | SetMixLevelMessage
      | LoadStemsMessage
      | StopStemsMessage
      | CaptureStandDownMessage
      | ListeningToMessage
      | RequestPrefetchMessage
      | RequestShadowUrlMessage
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

    postToPageWorld({ type: "blk-listening-to", videoId });

    if (videoId === crossfadingInto) {
      const landing = decideCrossfadeLanding({ kind: crossfadingIntoKind, status: state.status });
      disarmCrossfade();
      resetStemAssembly();
      resetStaging();
      prefetchVideoId = null;
      warmAllowedFor = null;
      climb = null;

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
    warmAllowedFor = null;
    climb = null;
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
      if (data.videoId === state.videoId) return;
      // The same next track is announced repeatedly. Once the page world's clock
      // reaches the tail it announces it again with permission to warm, and that
      // permission is the only new information, so re-probe rather than ignore.
      if (data.videoId === prefetchVideoId) {
        if (data.warm !== true || warmAllowedFor === data.videoId) return;
        warmAllowedFor = data.videoId;
        probeCacheFor(data.videoId);
        return;
      }
      resetStaging();
      prefetchVideoId = data.videoId;
      warmAllowedFor = data.warm === true ? data.videoId : null;
      trackStatusStore.setActivity(data.videoId, "queued");
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
      recordDelivery(data.videoId, null);
      dispatch({ type: "capture-ready", videoId: data.videoId });
      maybeAutoEngage(data.videoId);
      return;
    }

    if (isAcquisitionResultMessage(data)) {
      if (data.url === null) {
        onSourceSpent(data.videoId, data.source, data.reason);
        return;
      }
      if (data.videoId !== state.videoId) return;
      log(`${data.source} answered for ${data.videoId}, pulling the track`);
      recordDelivery(data.videoId, data.source);
      acquireFromUrl(data.videoId, data.url);
      return;
    }

    if (isDownloadProgressMessage(data)) {
      if (isStagingTarget(data.videoId)) trackStatusStore.setActivity(data.videoId, "downloading", data.fraction);
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
    const took = aheadStaging.addChunk(message.videoId, message.stem, message.index, message.total, message.data);
    if (!took) {
      logError(
        `could not stage ${message.stem} for ${message.videoId}`,
        new Error(`chunk ${message.index} of ${message.total} was refused`)
      );
      return;
    }
    finishStagingIfReady(message.videoId);
  }

  function finishStagingIfReady(videoId: string): void {
    const blobs = aheadStaging.finish(videoId);
    if (blobs === null) return;

    trackStatusStore.setActivity(videoId, "ready");
    trackStatusStore.setCached(videoId, true);
    const kilobytes = Math.round((blobs.vocals.size + blobs.instrumental.size) / 1024);
    log(`staged ${videoId} for a transition, ${kilobytes} kB of Opus held`);
    const ready: StagedReadyMessage = { type: "blk-staged-ready", videoId };
    postToPageWorld(ready);
  }

  function sendStagedDeck(videoId: string): void {
    const held = aheadStaging.heldFor(videoId);
    if (held === null) {
      log(`the page world asked for ${videoId} but nothing is staged under it`);
      return;
    }

    Promise.all([decodeOpusToPcm(held.vocals), decodeOpusToPcm(held.instrumental)])
      .then(([vocals, instrumental]) => {
        if (aheadStaging.heldVideoId !== videoId) return;
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
        aheadStaging.releaseHeld(videoId);
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
          log(`stems are shorter than the track, capturing it again: ${measured}`);
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
    if (isAcquireFailedMessage(message)) {
      if (message.videoId !== state.videoId) return;
      dispatch({ type: "reacquire", videoId: message.videoId });
      const spent = climb?.videoId === message.videoId ? climb.tried[climb.tried.length - 1] : null;
      if (spent) onSourceSpent(message.videoId, spent, message.reason);
      return;
    }
    if (isCacheHitMessage(message)) {
      trackStatusStore.setCached(message.videoId, true);
      if (isStagingTarget(message.videoId)) {
        trackStatusStore.setActivity(message.videoId, "ready");
        log(`next track ${message.videoId} is already separated, staging it`);
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
      trackStatusStore.setCached(message.videoId, false);
      if (message.videoId === prefetchVideoId) {
        if (warmAllowedFor !== message.videoId) {
          log(`next track ${message.videoId} is not separated yet, waiting for the tail of this track to warm it`);
          return;
        }
        trackStatusStore.setActivity(message.videoId, "downloading");
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
      if (isStagingTarget(message.videoId) && message.total > 0) {
        trackStatusStore.setActivity(message.videoId, "separating", message.processed / message.total);
      }
      dispatch({ type: "progress", videoId: message.videoId, processed: message.processed, total: message.total });
      return;
    }
    if (isStemChunkMessage(message)) {
      handleStemChunk(message);
      return;
    }
    if (isTrackDoneMessage(message)) {
      if (isStagingTarget(message.videoId)) {
        aheadStaging.markDone(message.videoId);
        finishStagingIfReady(message.videoId);
        return;
      }
      log(`all stems delivered for ${message.videoId}`);
      doneReceived = true;
      finishStemsIfReady(message.videoId);
      return;
    }
    if (isTrackErrorMessage(message)) {
      if (isStagingTarget(message.videoId)) trackStatusStore.setActivity(message.videoId, "unavailable");
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

  function separationVetoFor(): SeparationVeto | null {
    return separationVeto({
      singAlongEnabled: settings.singAlongEnabled,
      autoSeparateEnabled: settings.autoSeparateEnabled,
      faderArmed: faderArmed(pendingMixLevel),
    });
  }

  function maybeAcquireCurrent(videoId: string): void {
    if (videoId !== state.videoId) return;
    const veto = separationVetoFor();
    if (veto) {
      log(`not acquiring ${videoId}, ${describeSeparationVeto(veto)}`);
      return;
    }
    if (climb?.videoId !== videoId) climb = { videoId, tried: [], inFlight: false, exhausted: false };
    if (climb.inFlight || climb.exhausted) return;

    const order = enabledOrder(sanitizeSourcePreferences(settings.sources));
    for (;;) {
      const source = nextSource({ order, playingTrack: true, tried: climb.tried });
      if (!source) {
        climb.exhausted = true;
        log(`every source has been tried for ${videoId}`);
        return;
      }
      climb.tried.push(source);
      if (source === "player-capture") {
        log(`${videoId} is covered by the listener's own playback once it buffers`);
        continue;
      }
      climb.inFlight = true;
      startSource(videoId, source);
      return;
    }
  }

  function recordDelivery(videoId: string, announcedSource: SourceId | null): void {
    const inFlightSource =
      climb?.videoId === videoId && climb.inFlight ? climb.tried[climb.tried.length - 1] ?? null : null;
    delivery = { videoId, source: deliveredBy({ inFlightSource, announcedSource }) };
  }

  function startSource(videoId: string, source: SourceId): void {
    if (source === "shadow-url") {
      log(`acquiring ${videoId} from a url a shadow player mints in this page`);
      postToPageWorld({ type: "blk-request-shadow-url", videoId });
      return;
    }
    log(`acquiring ${videoId} in a hidden player`);
    postToPageWorld({ type: "blk-request-prefetch", videoId });
  }

  function onSourceSpent(videoId: string, source: SourceId, reason: string): void {
    if (videoId !== state.videoId || climb?.videoId !== videoId) return;
    if (!climb.tried.includes(source)) return;
    log(`${source} could not get ${videoId}: ${reason}`);
    climb.inFlight = false;
    maybeAcquireCurrent(videoId);
  }

  function acquireFromUrl(videoId: string, url: string): void {
    const command: AcquireTrackCommand = { type: "blk-acquire-track", videoId, url };
    chrome.runtime.sendMessage(command).catch(error => logError("failed to send an acquire command", error));
    dispatch({ type: "acquiring", videoId });
  }

  function maybeSeparateAhead(videoId: string): void {
    if (videoId !== prefetchVideoId) return;
    const veto = separationVetoFor();
    if (veto) {
      log(`next track ${videoId} acquired, held for a crossfade but not separated: ${describeSeparationVeto(veto)}`);
      return;
    }
    if (state.status !== "engaged" && state.status !== "failed") {
      log(`next track ${videoId} acquired, waiting for ${state.videoId} to finish before separating it`);
      return;
    }
    trackStatusStore.setActivity(videoId, "separating");
    log(`next track ${videoId} acquired, separating it ahead of time`);
    const request: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId };
    window.postMessage(request, window.location.origin);
  }

  function maybeAutoEngage(videoId: string): void {
    if (separationVetoFor() !== null) return;
    if (videoId !== state.videoId || state.status !== "ready-to-engage") return;

    log(`auto-separating ${videoId}`);
    dispatch({ type: "engage", videoId });
    requestCapturedAudio(videoId);
  }

  function engage(mixLevel: number, glideSeconds?: number): void {
    pendingMixLevel = mixLevel;
    postToPageWorld({ type: "blk-set-mix-level", mixLevel, glideSeconds });

    if (!faderArmed(mixLevel)) return;
    if (state.status === "waiting-for-capture") {
      log(`arming ${state.videoId}, acquiring it now that the fader asked for it`);
      maybeAcquireCurrent(state.videoId);
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

  function setSettings(next: Settings): void {
    settings = next;
  }

  function setCrossfadeSeconds(seconds: number): void {
    postToPageWorld({ type: "blk-set-crossfade", seconds });
  }

  function deliveredSource(videoId: string): SourceId | null {
    return delivery?.videoId === videoId ? delivery.source : null;
  }

  return { engage, setSettings, setCrossfadeSeconds, deliveredSource, destroy };
}

export { createKaraokePipeline };
export type { KaraokePipeline, KaraokePipelineOptions };
